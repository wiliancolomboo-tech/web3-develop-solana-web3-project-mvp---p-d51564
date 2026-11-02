import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { UnivibeProtocol } from "../target/types/univibe_protocol";
import { PublicKey, Keypair, SystemProgram, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { assert, expect } from "chai";

describe("univibe_protocol", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.UnivibeProtocol as Program<UnivibeProtocol>;

  const poolAuthority = Keypair.generate();
  const reviewerMultisig = Keypair.generate();
  const student = Keypair.generate();
  const voter1 = Keypair.generate();
  const voter2 = Keypair.generate();

  const poolNameBuffer = Buffer.alloc(32);
  poolNameBuffer.write("KUBG-CAMPUS-FUND-2025");

  let poolPda: PublicKey;
  let vaultPda: PublicKey;
  const proposalId = new anchor.BN(1001);
  let proposalPda: PublicKey;

  before(async () => {
    // Airdrop funds to actors
    const airdropSigners = [poolAuthority, reviewerMultisig, student, voter1, voter2];
    for (const signer of airdropSigners) {
      const sig = await provider.connection.requestAirdrop(signer.publicKey, 10 * LAMPORTS_PER_SOL);
      const latestBlockhash = await provider.connection.getLatestBlockhash();
      await provider.connection.confirmTransaction({
        signature: sig,
        blockhash: latestBlockhash.blockhash,
        lastValidBlockHeight: latestBlockhash.lastValidBlockHeight,
      });
    }

    [poolPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("univibe_pool"), poolNameBuffer],
      program.programId
    );

    [vaultPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("univibe_vault"), poolPda.toBuffer()],
      program.programId
    );

    [proposalPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("univibe_proposal"), poolPda.toBuffer(), proposalId.toArrayLike(Buffer, "le", 8)],
      program.programId
    );
  });

  it("1. Successfully initializes an Endowment Pool with PDA vault", async () => {
    const maxCeiling = new anchor.BN(3 * LAMPORTS_PER_SOL);
    const minVotingSlots = new anchor.BN(10);
    const quorum = new anchor.BN(2);
    const initialLamports = new anchor.BN(5 * LAMPORTS_PER_SOL);

    await program.methods
      .initializePool(
        Array.from(poolNameBuffer),
        maxCeiling,
        minVotingSlots,
        quorum,
        initialLamports
      )
      .accounts({
        pool: poolPda,
        vault: vaultPda,
        reviewerAuthority: reviewerMultisig.publicKey,
        authority: poolAuthority.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([poolAuthority])
      .rpc();

    const poolAccount = await program.account.endowmentPool.fetch(poolPda);
    assert.equal(poolAccount.authority.toBase58(), poolAuthority.publicKey.toBase58());
    assert.equal(poolAccount.maxDisbursementCeiling.toString(), maxCeiling.toString());

    const vaultBalance = await provider.connection.getBalance(vaultPda);
    assert.equal(vaultBalance, initialLamports.toNumber());
  });

  it("2. Rejects proposal exceeding disbursement ceiling", async () => {
    const excessiveAmount = new anchor.BN(10 * LAMPORTS_PER_SOL);
    const dummyCid = new Array(32).fill(7);

    try {
      await program.methods
        .submitProposal(new anchor.BN(9999), excessiveAmount, dummyCid)
        .accounts({
          pool: poolPda,
          proposal: PublicKey.findProgramAddressSync(
            [Buffer.from("univibe_proposal"), poolPda.toBuffer(), new anchor.BN(9999).toArrayLike(Buffer, "le", 8)],
            program.programId
          )[0],
          student: student.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([student])
        .rpc();
      assert.fail("Should have thrown DisbursementExceedsCeiling");
    } catch (err: any) {
      expect(err.error.errorCode.code).to.equal("DisbursementExceedsCeiling");
    }
  });

  it("3. Successfully registers valid Scholar Proposal", async () => {
    const requestedAmount = new anchor.BN(2 * LAMPORTS_PER_SOL);
    const dummyCid = new Array(32).fill(1);

    await program.methods
      .submitProposal(proposalId, requestedAmount, dummyCid)
      .accounts({
        pool: poolPda,
        proposal: proposalPda,
        student: student.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([student])
      .rpc();

    const proposalAccount = await program.account.scholarProposal.fetch(proposalPda);
    assert.equal(proposalAccount.student.toBase58(), student.publicKey.toBase58());
    assert.equal(proposalAccount.requestedAmount.toNumber(), requestedAmount.toNumber());
    assert.deepEqual(proposalAccount.status, { voting: {} });
  });

  it("4. Casts Quadratic Votes with deterministic weight sqrt(tokens)", async () => {
    const rawTokensVoter1 = new anchor.BN(16); // sqrt(16) = 4
    const [ballotPda1] = PublicKey.findProgramAddressSync(
      [Buffer.from("univibe_ballot"), proposalPda.toBuffer(), voter1.publicKey.toBuffer()],
      program.programId
    );

    await program.methods
      .castVote(true, rawTokensVoter1)
      .accounts({
        proposal: proposalPda,
        ballot: ballotPda1,
        voter: voter1.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([voter1])
      .rpc();

    let proposal = await program.account.scholarProposal.fetch(proposalPda);
    assert.equal(proposal.affirmativePower.toNumber(), 4);

    // Voter 2 votes affirmative with 9 tokens -> sqrt(9) = 3
    const rawTokensVoter2 = new anchor.BN(9);
    const [ballotPda2] = PublicKey.findProgramAddressSync(
      [Buffer.from("univibe_ballot"), proposalPda.toBuffer(), voter2.publicKey.toBuffer()],
      program.programId
    );

    await program.methods
      .castVote(true, rawTokensVoter2)
      .accounts({
        proposal: proposalPda,
        ballot: ballotPda2,
        voter: voter2.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([voter2])
      .rpc();

    proposal = await program.account.scholarProposal.fetch(proposalPda);
    assert.equal(proposal.affirmativePower.toNumber(), 7); // 4 + 3 = 7
  });

  it("5. Rejects Milestone Payout when called by unauthorized reviewer", async () => {
    const impostorReviewer = Keypair.generate();
    try {
      await program.methods
        .executeMilestonePayout()
        .accounts({
          pool: poolPda,
          vault: vaultPda,
          proposal: proposalPda,
          studentRecipient: student.publicKey,
          reviewerMultisig: impostorReviewer.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([impostorReviewer])
        .rpc();
      assert.fail("Should have failed authorization check");
    } catch (err: any) {
      expect(err.error.errorCode.code).to.equal("UnauthorizedReviewer");
    }
  });

  it("6. Executes Milestone Payout autonomously with proper PDA signoff", async () => {
    const studentBalanceBefore = await provider.connection.getBalance(student.publicKey);
    const vaultBalanceBefore = await provider.connection.getBalance(vaultPda);

    await program.methods
      .executeMilestonePayout()
      .accounts({
        pool: poolPda,
        vault: vaultPda,
        proposal: proposalPda,
        studentRecipient: student.publicKey,
        reviewerMultisig: reviewerMultisig.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([reviewerMultisig])
      .rpc();

    const studentBalanceAfter = await provider.connection.getBalance(student.publicKey);
    const vaultBalanceAfter = await provider.connection.getBalance(vaultPda);
    const proposal = await program.account.scholarProposal.fetch(proposalPda);

    assert.deepEqual(proposal.status, { disbursed: {} });
    assert.equal(studentBalanceAfter - studentBalanceBefore, 2 * LAMPORTS_PER_SOL);
    assert.equal(vaultBalanceBefore - vaultBalanceAfter, 2 * LAMPORTS_PER_SOL);
  });

  it("7. Prevents double-disbursement replay attack on settled proposal", async () => {
    try {
      await program.methods
        .executeMilestonePayout()
        .accounts({
          pool: poolPda,
          vault: vaultPda,
          proposal: proposalPda,
          studentRecipient: student.publicKey,
          reviewerMultisig: reviewerMultisig.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([reviewerMultisig])
        .rpc();
      assert.fail("Should have failed on already disbursed milestone");
    } catch (err: any) {
      expect(err.error.errorCode.code).to.equal("ProposalNotActive");
    }
  });
});