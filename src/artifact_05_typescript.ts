// File: tests/univibe_core.ts

import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { PublicKey, Keypair, SystemProgram, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { expect } from "chai";
import * as crypto from "crypto";

describe("univibe_core Protocol Unit & Integration Tests", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  // Load program reference
  const program = anchor.workspace.UnivibeCore as Program<any>;

  const initiator = Keypair.generate();
  const contributor = Keypair.generate();
  const arbiter = Keypair.generate();

  const bountyId = new anchor.BN(Date.now());
  const title = "Implement Solana Blinks for KUBG Portal";
  const dummyDescriptionHash = crypto.createHash("sha256").update("Specification v1").digest();
  const dummySubmissionHash = crypto.createHash("sha256").update("https://github.com/kubg/submission").digest();
  const payoutAmount = new anchor.BN(0.5 * LAMPORTS_PER_SOL);

  let bountyPda: PublicKey;
  let bountyBump: number;
  let vaultPda: PublicKey;
  let vaultBump: number;

  before(async () => {
    // Airdrop funds to actors
    const airdropSigs = await Promise.all([
      provider.connection.requestAirdrop(initiator.publicKey, 2 * LAMPORTS_PER_SOL),
      provider.connection.requestAirdrop(contributor.publicKey, 1 * LAMPORTS_PER_SOL),
      provider.connection.requestAirdrop(arbiter.publicKey, 1 * LAMPORTS_PER_SOL),
    ]);
    await Promise.all(airdropSigs.map((sig) => provider.connection.confirmTransaction(sig, "confirmed")));

    // Derive Bounty and Vault PDAs
    const bountyIdBuffer = bountyId.toArrayLike(Buffer, "le", 8);
    [bountyPda, bountyBump] = PublicKey.findProgramAddressSync(
      [Buffer.from("bounty"), initiator.publicKey.toBuffer(), bountyIdBuffer],
      program.programId
    );

    [vaultPda, vaultBump] = PublicKey.findProgramAddressSync(
      [Buffer.from("vault"), bountyPda.toBuffer()],
      program.programId
    );
  });

  it("1. Successfully initializes a campus micro-bounty escrow", async () => {
    const currentBlockTime = Math.floor(Date.now() / 1000);
    const deadline = new anchor.BN(currentBlockTime + 3600); // 1 hour out

    const tx = await program.methods
      .initializeBounty(
        bountyId,
        title,
        Array.from(dummyDescriptionHash),
        payoutAmount,
        deadline
      )
      .accounts({
        bounty: bountyPda,
        vault: vaultPda,
        arbiter: arbiter.publicKey,
        initiator: initiator.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([initiator])
      .rpc();

    expect(tx).to.be.a("string");

    // Assert On-Chain State
    const bountyAccount = await program.account.bounty.fetch(bountyPda);
    expect(bountyAccount.initiator.toBase58()).to.equal(initiator.publicKey.toBase58());
    expect(bountyAccount.arbiter.toBase58()).to.equal(arbiter.publicKey.toBase58());
    expect(bountyAccount.payoutAmount.toNumber()).to.equal(payoutAmount.toNumber());
    expect(JSON.stringify(bountyAccount.state)).to.include("open");

    // Check Vault SOL balance
    const vaultBalance = await provider.connection.getBalance(vaultPda);
    expect(vaultBalance).to.equal(payoutAmount.toNumber());
  });

  it("2. Fails to initialize if deadline is in the past", async () => {
    const pastBountyId = new anchor.BN(Date.now() + 100);
    const pastDeadline = new anchor.BN(Math.floor(Date.now() / 1000) - 100);

    const [failPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("bounty"), initiator.publicKey.toBuffer(), pastBountyId.toArrayLike(Buffer, "le", 8)],
      program.programId
    );
    const [failVault] = PublicKey.findProgramAddressSync(
      [Buffer.from("vault"), failPda.toBuffer()],
      program.programId
    );

    try {
      await program.methods
        .initializeBounty(
          pastBountyId,
          "Expired Task",
          Array.from(dummyDescriptionHash),
          payoutAmount,
          pastDeadline
        )
        .accounts({
          bounty: failPda,
          vault: failVault,
          arbiter: arbiter.publicKey,
          initiator: initiator.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([initiator])
        .rpc();
      expect.fail("Should have thrown InvalidDeadline error");
    } catch (err: any) {
      expect(err.error.errorCode.code).to.equal("InvalidDeadline");
    }
  });

  it("3. Contributor submits milestone proof of work", async () => {
    const tx = await program.methods
      .submitMilestone(Array.from(dummySubmissionHash))
      .accounts({
        bounty: bountyPda,
        contributor: contributor.publicKey,
      })
      .signers([contributor])
      .rpc();

    expect(tx).to.be.a("string");

    const bountyAccount = await program.account.bounty.fetch(bountyPda);
    expect(bountyAccount.contributor.toBase58()).to.equal(contributor.publicKey.toBase58());
    expect(JSON.stringify(bountyAccount.state)).to.include("submitted");
  });

  it("4. Prevents unauthorized party from releasing escrow funds", async () => {
    const rogue = Keypair.generate();
    await provider.connection.confirmTransaction(
      await provider.connection.requestAirdrop(rogue.publicKey, LAMPORTS_PER_SOL),
      "confirmed"
    );

    try {
      await program.methods
        .releaseBounty()
        .accounts({
          bounty: bountyPda,
          vault: vaultPda,
          contributor: contributor.publicKey,
          authority: rogue.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([rogue])
        .rpc();
      expect.fail("Unauthorized release should have failed");
    } catch (err: any) {
      expect(err.error.errorCode.code).to.equal("UnauthorizedSettlement");
    }
  });

  it("5. Allows Initiator to release escrow and complete payment", async () => {
    const preBalance = await provider.connection.getBalance(contributor.publicKey);

    const tx = await program.methods
      .releaseBounty()
      .accounts({
        bounty: bountyPda,
        vault: vaultPda,
        contributor: contributor.publicKey,
        authority: initiator.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([initiator])
      .rpc();

    expect(tx).to.be.a("string");

    const postBalance = await provider.connection.getBalance(contributor.publicKey);
    expect(postBalance - preBalance).to.equal(payoutAmount.toNumber());

    const bountyAccount = await program.account.bounty.fetch(bountyPda);
    expect(JSON.stringify(bountyAccount.state)).to.include("completed");
  });
});