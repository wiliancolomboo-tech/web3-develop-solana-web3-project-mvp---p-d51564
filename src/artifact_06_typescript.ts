import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { CampusVibe } from "../target/types/campus_vibe";
import { PublicKey, Keypair, SystemProgram, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { expect } from "chai";
import * as crypto from "crypto";

describe("CampusVibe Protocol Test Matrix", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.CampusVibe as Program<CampusVibe>;

  const hubAuthority = Keypair.generate();
  const sponsor = Keypair.generate();
  const hacker = Keypair.generate();
  const maliciousActor = Keypair.generate();

  const bountyId = new anchor.BN(Date.now());
  const bountyReward = new anchor.BN(1 * LAMPORTS_PER_SOL);

  let hubPda: PublicKey;
  let bountyPda: PublicKey;
  let vaultPda: PublicKey;
  let submissionPda: PublicKey;

  before(async () => {
    // Airdrop funds to all test actors
    const airdropSigners = [hubAuthority, sponsor, hacker, maliciousActor];
    for (const actor of airdropSigners) {
      const sig = await provider.connection.requestAirdrop(actor.publicKey, 5 * LAMPORTS_PER_SOL);
      const latestBlockhash = await provider.connection.getLatestBlockhash();
      await provider.connection.confirmTransaction({
        signature: sig,
        ...latestBlockhash,
      });
    }

    // Derive PDAs
    [hubPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("hub"), hubAuthority.publicKey.toBuffer()],
      program.programId
    );

    const bountyIdBuffer = bountyId.toArrayLike(Buffer, "le", 8);
    [bountyPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("bounty"), bountyIdBuffer],
      program.programId
    );

    [vaultPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("vault"), bountyIdBuffer],
      program.programId
    );

    [submissionPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("submission"), bountyIdBuffer, hacker.publicKey.toBuffer()],
      program.programId
    );
  });

  it("1. Initializes the Global Campus Hub", async () => {
    const feeBasisPoints = 250; // 2.5%

    await program.methods
      .initializeHub(feeBasisPoints)
      .accounts({
        hub: hubPda,
        authority: hubAuthority.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([hubAuthority])
      .rpc();

    const hubAccount = await program.account.hubConfig.fetch(hubPda);
    expect(hubAccount.authority.toBase58()).to.equal(hubAuthority.publicKey.toBase58());
    expect(hubAccount.feeBasisPoints).to.equal(250);
    expect(hubAccount.bountyCount.toNumber()).to.equal(0);
  });

  it("2. Creates a Bounty and Escrows Native SOL into Vault PDA", async () => {
    const title = "Build Solana DeFi Micro-Savings Module";
    const uri = "https://ipfs.io/ipfs/bafybeicampusvibe-metadata";
    const deadline = new anchor.BN(Math.floor(Date.now() / 1000) + 3600); // 1 hour future

    const initialSponsorBal = await provider.connection.getBalance(sponsor.publicKey);

    await program.methods
      .createBounty(bountyId, title, uri, bountyReward, deadline)
      .accounts({
        hub: hubPda,
        bounty: bountyPda,
        bountyVault: vaultPda,
        creator: sponsor.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([sponsor])
      .rpc();

    const bountyAccount = await program.account.bountyRecord.fetch(bountyPda);
    expect(bountyAccount.title).to.equal(title);
    expect(bountyAccount.creator.toBase58()).to.equal(sponsor.publicKey.toBase58());
    expect(bountyAccount.rewardLamports.toNumber()).to.equal(bountyReward.toNumber());
    expect(JSON.stringify(bountyAccount.status)).to.include("open");

    const vaultBalance = await provider.connection.getBalance(vaultPda);
    expect(vaultBalance).to.equal(bountyReward.toNumber());

    const finalSponsorBal = await provider.connection.getBalance(sponsor.publicKey);
    expect(initialSponsorBal - finalSponsorBal).to.be.greaterThan(bountyReward.toNumber());
  });

  it("3. Allows Hacker to Submit Deliverable with Cryptographic Proof Digest", async () => {
    const submissionUri = "https://github.com/kubg-student/solana-savings";
    const rawProof = Buffer.from("proof_of_hackathon_build_v1");
    const proofDigest = Array.from(crypto.createHash("sha256").update(rawProof).digest());

    await program.methods
      .submitWork(bountyId, proofDigest, submissionUri)
      .accounts({
        bounty: bountyPda,
        submission: submissionPda,
        student: hacker.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([hacker])
      .rpc();

    const submission = await program.account.submissionRecord.fetch(submissionPda);
    expect(submission.student.toBase58()).to.equal(hacker.publicKey.toBase58());
    expect(submission.submissionUri).to.equal(submissionUri);
    expect(submission.bountyId.toNumber()).to.equal(bountyId.toNumber());
  });

  it("4. Rejects Unauthorized Signer from Approving the Bounty", async () => {
    try {
      await program.methods
        .approveSubmission(bountyId)
        .accounts({
          bounty: bountyPda,
          bountyVault: vaultPda,
          creator: maliciousActor.publicKey, // Malicious actor tries to approve
          student: maliciousActor.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([maliciousActor])
        .rpc();
      expect.fail("Unauthorized approval should have failed");
    } catch (err: any) {
      expect(err.error.errorCode.code).to.equal("Unauthorized");
    }
  });

  it("5. Sponsor Approves Deliverable & Instantly Releases Escrowed Lamports", async () => {
    const hackerInitialBal = await provider.connection.getBalance(hacker.publicKey);

    await program.methods
      .approveSubmission(bountyId)
      .accounts({
        bounty: bountyPda,
        bountyVault: vaultPda,
        creator: sponsor.publicKey,
        student: hacker.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([sponsor])
      .rpc();

    const bountyAccount = await program.account.bountyRecord.fetch(bountyPda);
    expect(JSON.stringify(bountyAccount.status)).to.include("approved");
    expect(bountyAccount.claimedBy.toBase58()).to.equal(hacker.publicKey.toBase58());

    const hackerFinalBal = await provider.connection.getBalance(hacker.publicKey);
    expect(hackerFinalBal - hackerInitialBal).to.equal(bountyReward.toNumber());

    const vaultBalance = await provider.connection.getBalance(vaultPda);
    expect(vaultBalance).to.equal(0);
  });

  it("6. Prevents Double Settlement or Refund on Already Approved Bounty", async () => {
    try {
      await program.methods
        .claimRefund(bountyId)
        .accounts({
          bounty: bountyPda,
          bountyVault: vaultPda,
          creator: sponsor.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([sponsor])
        .rpc();
      expect.fail("Refunding an approved bounty should be rejected");
    } catch (err: any) {
      expect(err.error.errorCode.code).to.equal("BountyNotOpen");
    }
  });
});