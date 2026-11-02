import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { VibeVault } from "../target/types/vibe_vault";
import {
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
} from "@solana/web3.js";
import { expect } from "chai";
import crypto from "crypto";

describe("VibeVault Protocol Security & Integration Tests", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.VibeVault as Program<VibeVault>;

  const sponsor = Keypair.generate();
  const recipient = Keypair.generate();
  const evaluator1 = Keypair.generate();
  const evaluator2 = Keypair.generate();
  const unauthorizedUser = Keypair.generate();

  const vaultSeed = Buffer.from("vibe_vault_seed");
  const milestoneSeed = Buffer.from("vibe_milestone_seed");

  before(async () => {
    // Airdrop balances to test participants
    const airdropPromises = [
      sponsor,
      recipient,
      evaluator1,
      evaluator2,
      unauthorizedUser,
    ].map(async (acc) => {
      const sig = await provider.connection.requestAirdrop(
        acc.publicKey,
        10 * LAMPORTS_PER_SOL
      );
      await provider.connection.confirmTransaction(sig, "confirmed");
    });
    await Promise.all(airdropPromises);
  });

  it("1. Successfully initializes a grant vault with locked SOL", async () => {
    const vaultId = new anchor.BN(Date.now());
    const grantAmount = new anchor.BN(2 * LAMPORTS_PER_SOL);
    const quorum = 2;
    const now = Math.floor(Date.now() / 1000);
    const expiration = new anchor.BN(now + 100);

    const [vaultPda] = PublicKey.findProgramAddressSync(
      [vaultSeed, sponsor.publicKey.toBuffer(), vaultId.toArrayLike(Buffer, "le", 8)],
      program.programId
    );

    const initialSponsorBal = await provider.connection.getBalance(sponsor.publicKey);

    await program.methods
      .initializeVault(vaultId, grantAmount, quorum, expiration)
      .accounts({
        vault: vaultPda,
        sponsor: sponsor.publicKey,
        recipient: recipient.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([sponsor])
      .rpc();

    const vaultAccount = await program.account.vaultState.fetch(vaultPda);
    expect(vaultAccount.sponsor.toBase58()).to.equal(sponsor.publicKey.toBase58());
    expect(vaultAccount.recipient.toBase58()).to.equal(recipient.publicKey.toBase58());
    expect(vaultAccount.totalGrantAmount.toString()).to.equal(grantAmount.toString());
    expect(vaultAccount.quorumThreshold).to.equal(quorum);
    expect(vaultAccount.isActive).to.be.true;

    const vaultLamports = await provider.connection.getBalance(vaultPda);
    expect(vaultLamports).to.be.gte(grantAmount.toNumber());
  });

  it("2. Registers milestone under vault within total balance cap", async () => {
    const vaultId = new anchor.BN(Date.now() + 1);
    const grantAmount = new anchor.BN(2 * LAMPORTS_PER_SOL);
    const quorum = 2;
    const expiration = new anchor.BN(Math.floor(Date.now() / 1000) + 200);

    const [vaultPda] = PublicKey.findProgramAddressSync(
      [vaultSeed, sponsor.publicKey.toBuffer(), vaultId.toArrayLike(Buffer, "le", 8)],
      program.programId
    );

    await program.methods
      .initializeVault(vaultId, grantAmount, quorum, expiration)
      .accounts({
        vault: vaultPda,
        sponsor: sponsor.publicKey,
        recipient: recipient.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([sponsor])
      .rpc();

    const milestoneIndex = 0;
    const milestoneAmount = new anchor.BN(1 * LAMPORTS_PER_SOL);
    const descriptionHash = crypto.createHash("sha256").update("MVP Delivery").digest();

    const [milestonePda] = PublicKey.findProgramAddressSync(
      [milestoneSeed, vaultPda.toBuffer(), Buffer.from([milestoneIndex])],
      program.programId
    );

    await program.methods
      .registerMilestone(milestoneIndex, milestoneAmount, Array.from(descriptionHash))
      .accounts({
        vault: vaultPda,
        milestone: milestonePda,
        sponsor: sponsor.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([sponsor])
      .rpc();

    const milestoneAccount = await program.account.milestoneState.fetch(milestonePda);
    expect(milestoneAccount.amount.toString()).to.equal(milestoneAmount.toString());
    expect(milestoneAccount.isCompleted).to.be.false;
    expect(milestoneAccount.approvalCount).to.equal(0);
  });

  it("3. Prevents milestone fund claim prior to reaching quorum threshold", async () => {
    const vaultId = new anchor.BN(Date.now() + 2);
    const grantAmount = new anchor.BN(1 * LAMPORTS_PER_SOL);
    const quorum = 2;
    const expiration = new anchor.BN(Math.floor(Date.now() / 1000) + 300);

    const [vaultPda] = PublicKey.findProgramAddressSync(
      [vaultSeed, sponsor.publicKey.toBuffer(), vaultId.toArrayLike(Buffer, "le", 8)],
      program.programId
    );

    await program.methods
      .initializeVault(vaultId, grantAmount, quorum, expiration)
      .accounts({
        vault: vaultPda,
        sponsor: sponsor.publicKey,
        recipient: recipient.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([sponsor])
      .rpc();

    const milestoneIndex = 0;
    const milestoneAmount = new anchor.BN(1 * LAMPORTS_PER_SOL);
    const descriptionHash = crypto.createHash("sha256").update("Alpha Test").digest();

    const [milestonePda] = PublicKey.findProgramAddressSync(
      [milestoneSeed, vaultPda.toBuffer(), Buffer.from([milestoneIndex])],
      program.programId
    );

    await program.methods
      .registerMilestone(milestoneIndex, milestoneAmount, Array.from(descriptionHash))
      .accounts({
        vault: vaultPda,
        milestone: milestonePda,
        sponsor: sponsor.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([sponsor])
      .rpc();

    // Only 1 approval submitted (requires 2)
    await program.methods
      .approveMilestone(milestoneIndex)
      .accounts({
        vault: vaultPda,
        milestone: milestonePda,
        evaluator: evaluator1.publicKey,
      })
      .signers([evaluator1])
      .rpc();

    let errorThrown = false;
    try {
      await program.methods
        .claimMilestoneFunds(milestoneIndex)
        .accounts({
        vault: vaultPda,
        milestone: milestonePda,
        recipient: recipient.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([recipient])
      .rpc();
    } catch (err: any) {
      errorThrown = true;
      expect(err.message).to.include("QuorumNotReached");
    }
    expect(errorThrown).to.be.true;
  });

  it("4. Evaluator quorum satisfied, transfers lamports directly to grantee", async () => {
    const vaultId = new anchor.BN(Date.now() + 3);
    const grantAmount = new anchor.BN(1 * LAMPORTS_PER_SOL);
    const quorum = 2;
    const expiration = new anchor.BN(Math.floor(Date.now() / 1000) + 300);

    const [vaultPda] = PublicKey.findProgramAddressSync(
      [vaultSeed, sponsor.publicKey.toBuffer(), vaultId.toArrayLike(Buffer, "le", 8)],
      program.programId
    );

    await program.methods
      .initializeVault(vaultId, grantAmount, quorum, expiration)
      .accounts({
        vault: vaultPda,
        sponsor: sponsor.publicKey,
        recipient: recipient.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([sponsor])
      .rpc();

    const milestoneIndex = 0;
    const milestoneAmount = new anchor.BN(1 * LAMPORTS_PER_SOL);
    const descriptionHash = crypto.createHash("sha256").update("Final Release").digest();

    const [milestonePda] = PublicKey.findProgramAddressSync(
      [milestoneSeed, vaultPda.toBuffer(), Buffer.from([milestoneIndex])],
      program.programId
    );

    await program.methods
      .registerMilestone(milestoneIndex, milestoneAmount, Array.from(descriptionHash))
      .accounts({
        vault: vaultPda,
        milestone: milestonePda,
        sponsor: sponsor.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([sponsor])
      .rpc();

    // Evaluator 1 approves
    await program.methods
      .approveMilestone(milestoneIndex)
      .accounts({
        vault: vaultPda,
        milestone: milestonePda,
        evaluator: evaluator1.publicKey,
      })
      .signers([evaluator1])
      .rpc();

    // Evaluator 2 approves (Quorum satisfied)
    await program.methods
      .approveMilestone(milestoneIndex)
      .accounts({
        vault: vaultPda,
        milestone: milestonePda,
        evaluator: evaluator2.publicKey,
      })
      .signers([evaluator2])
      .rpc();

    const beforeRecipientBal = await provider.connection.getBalance(recipient.publicKey);

    // Grantee claims funds
    await program.methods
      .claimMilestoneFunds(milestoneIndex)
      .accounts({
        vault: vaultPda,
        milestone: milestonePda,
        recipient: recipient.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([recipient])
      .rpc();

    const afterRecipientBal = await provider.connection.getBalance(recipient.publicKey);
    expect(afterRecipientBal - beforeRecipientBal).to.equal(milestoneAmount.toNumber());

    const milestoneAccount = await program.account.milestoneState.fetch(milestonePda);
    expect(milestoneAccount.isCompleted).to.be.true;
  });

  it("5. Clawback refunds sponsor if vault expires before claim", async () => {
    const vaultId = new anchor.BN(Date.now() + 4);
    const grantAmount = new anchor.BN(1 * LAMPORTS_PER_SOL);
    const quorum = 1;
    // Set expiration to 2 seconds from now
    const expiration = new anchor.BN(Math.floor(Date.now() / 1000) + 2);

    const [vaultPda] = PublicKey.findProgramAddressSync(
      [vaultSeed, sponsor.publicKey.toBuffer(), vaultId.toArrayLike(Buffer, "le", 8)],
      program.programId
    );

    await program.methods
      .initializeVault(vaultId, grantAmount, quorum, expiration)
      .accounts({
        vault: vaultPda,
        sponsor: sponsor.publicKey,
        recipient: recipient.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([sponsor])
      .rpc();

    // Wait 3 seconds for expiration
    await new Promise((resolve) => setTimeout(resolve, 3000));

    const beforeSponsorBal = await provider.connection.getBalance(sponsor.publicKey);

    await program.methods
      .clawbackExpiredVault()
      .accounts({
        vault: vaultPda,
        sponsor: sponsor.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([sponsor])
      .rpc();

    const afterSponsorBal = await provider.connection.getBalance(sponsor.publicKey);
    expect(afterSponsorBal).to.be.gt(beforeSponsorBal);

    const vaultAccount = await program.account.vaultState.fetch(vaultPda);
    expect(vaultAccount.isActive).to.be.false;
  });
});