import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Keypair, LAMPORTS_PER_SOL, PublicKey, SystemProgram } from "@solana/web3.js";
import { expect } from "chai";
import { Unistream } from "../target/types/unistream";

describe("unistream protocol end-to-end test suite", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.Unistream as Program<Unistream>;

  const authority = Keypair.generate();
  const reviewer = Keypair.generate();
  const grantee = Keypair.generate();
  const unauthorizedSigner = Keypair.generate();

  const poolId = new anchor.BN(101);
  const grantId = new anchor.BN(5001);
  const grantTotal = new anchor.BN(2 * LAMPORTS_PER_SOL);
  const milestoneCount = 2;

  let poolPda: PublicKey;
  let poolBump: number;
  let grantPda: PublicKey;
  let grantBump: number;
  let vaultPda: PublicKey;
  let vaultBump: number;

  before(async () => {
    // Airdrop SOL to test actors
    for (const actor of [authority, reviewer, grantee, unauthorizedSigner]) {
      const sig = await provider.connection.requestAirdrop(actor.publicKey, 5 * LAMPORTS_PER_SOL);
      await provider.connection.confirmTransaction(sig, "confirmed");
    }

    [poolPda, poolBump] = PublicKey.findProgramAddressSync(
      [Buffer.from("pool"), authority.publicKey.toBuffer(), poolId.toArrayLike(Buffer, "le", 8)],
      program.programId
    );

    [grantPda, grantBump] = PublicKey.findProgramAddressSync(
      [Buffer.from("grant"), poolPda.toBuffer(), grantId.toArrayLike(Buffer, "le", 8)],
      program.programId
    );

    [vaultPda, vaultBump] = PublicKey.findProgramAddressSync(
      [Buffer.from("vault"), grantPda.toBuffer()],
      program.programId
    );
  });

  it("1. Initializes a University Endowment Pool", async () => {
    const tx = await program.methods
      .initializePool("KUBG Blockchain Lab Fund", poolId)
      .accounts({
        pool: poolPda,
        authority: authority.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([authority])
      .rpc();

    expect(tx).to.be.a("string");

    const poolAccount = await program.account.universityPool.fetch(poolPda);
    expect(poolAccount.name).to.equal("KUBG Blockchain Lab Fund");
    expect(poolAccount.authority.toBase58()).to.equal(authority.publicKey.toBase58());
    expect(poolAccount.totalAllocated.toNumber()).to.equal(0);
    expect(poolAccount.grantCount.toNumber()).to.equal(0);
  });

  it("2. Initializes a Milestone-Gated Grant Stream and locks funds into PDA Vault", async () => {
    const now = Math.floor(Date.now() / 1000);
    const startTime = new anchor.BN(now - 10); // started 10 seconds ago
    const endTime = new anchor.BN(now + 100);  // runs for 110 total seconds

    await program.methods
      .initializeGrant(grantId, grantTotal, startTime, endTime, milestoneCount)
      .accounts({
        pool: poolPda,
        grant: grantPda,
        vault: vaultPda,
        grantee: grantee.publicKey,
        reviewer: reviewer.publicKey,
        authority: authority.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([authority])
      .rpc();

    const vaultBalance = await provider.connection.getBalance(vaultPda);
    expect(vaultBalance).to.equal(grantTotal.toNumber());

    const grantAccount = await program.account.grant.fetch(grantPda);
    expect(grantAccount.isActive).to.be.true;
    expect(grantAccount.approvedMilestones).to.equal(0);
    expect(grantAccount.claimedAmount.toNumber()).to.equal(0);
  });

  it("3. Fails when unauthorized signer attempts milestone approval", async () => {
    try {
      await program.methods
        .approveMilestone(1)
        .accounts({
          grant: grantPda,
          reviewer: unauthorizedSigner.publicKey,
        })
        .signers([unauthorizedSigner])
        .rpc();
      expect.fail("Should have failed with UnauthorizedReviewer");
    } catch (err: any) {
      expect(err.error.errorCode.code).to.equal("UnauthorizedReviewer");
    }
  });

  it("4. Fails when claiming funds before any milestone has been approved", async () => {
    try {
      await program.methods
        .claimFunds()
        .accounts({
          grant: grantPda,
          vault: vaultPda,
          grantee: grantee.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([grantee])
        .rpc();
      expect.fail("Should have failed with NoAvailableFunds");
    } catch (err: any) {
      expect(err.error.errorCode.code).to.equal("NoAvailableFunds");
    }
  });

  it("5. Fails if reviewer tries to approve milestones out of order (e.g. index 2 before 1)", async () => {
    try {
      await program.methods
        .approveMilestone(2)
        .accounts({
          grant: grantPda,
          reviewer: reviewer.publicKey,
        })
        .signers([reviewer])
        .rpc();
      expect.fail("Should have failed with NonSequentialMilestone");
    } catch (err: any) {
      expect(err.error.errorCode.code).to.equal("NonSequentialMilestone");
    }
  });

  it("6. Approves Milestone 1 successfully", async () => {
    await program.methods
      .approveMilestone(1)
      .accounts({
        grant: grantPda,
        reviewer: reviewer.publicKey,
      })
      .signers([reviewer])
      .rpc();

    const grantAccount = await program.account.grant.fetch(grantPda);
    expect(grantAccount.approvedMilestones).to.equal(1);
  });

  it("7. Grantee claims unlocked and accrued streaming funds", async () => {
    const granteeBalBefore = await provider.connection.getBalance(grantee.publicKey);

    const tx = await program.methods
      .claimFunds()
      .accounts({
        grant: grantPda,
        vault: vaultPda,
        grantee: grantee.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([grantee])
      .rpc();

    expect(tx).to.be.a("string");

    const granteeBalAfter = await provider.connection.getBalance(grantee.publicKey);
    expect(granteeBalAfter).to.be.greaterThan(granteeBalBefore);

    const grantAccount = await program.account.grant.fetch(grantPda);
    expect(grantAccount.claimedAmount.toNumber()).to.be.greaterThan(0);
  });

  it("8. Pool Authority revokes grant and recovers remaining unstreamed lamports", async () => {
    const authBalBefore = await provider.connection.getBalance(authority.publicKey);
    const vaultBalBefore = await provider.connection.getBalance(vaultPda);

    await program.methods
      .revokeGrant()
      .accounts({
        pool: poolPda,
        grant: grantPda,
        vault: vaultPda,
        authority: authority.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([authority])
      .rpc();

    const vaultBalAfter = await provider.connection.getBalance(vaultPda);
    const authBalAfter = await provider.connection.getBalance(authority.publicKey);

    expect(vaultBalAfter).to.equal(0);
    expect(authBalAfter).to.be.greaterThan(authBalBefore + vaultBalBefore - 100_000); // minus tx fee

    const grantAccount = await program.account.grant.fetch(grantPda);
    expect(grantAccount.isActive).to.be.false;
    expect(grantAccount.isRevoked).to.be.true;
  });
});