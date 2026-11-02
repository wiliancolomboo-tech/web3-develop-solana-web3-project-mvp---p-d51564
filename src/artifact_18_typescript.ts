import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { UniVibeEngine } from "../target/types/univibe_engine";
import { Keypair, LAMPORTS_PER_SOL, PublicKey, SystemProgram } from "@solana/web3.js";
import { expect } from "chai";
import crypto from "crypto";

describe("univibe-engine integration test matrix", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.UnivibeEngine as Program<UniVibeEngine>;

  const sponsor = Keypair.generate();
  const contributor = Keypair.generate();
  const unauthorizedActor = Keypair.generate();
  const arbitrator = Keypair.generate();

  const bountyId = new anchor.BN(8801);
  const bountyAmount = new anchor.BN(2 * LAMPORTS_PER_SOL);

  let bountyPda: PublicKey;
  let vaultPda: PublicKey;

  before(async () => {
    // Airdrop balances to test participants
    const airdropSponsor = await provider.connection.requestAirdrop(sponsor.publicKey, 10 * LAMPORTS_PER_SOL);
    const airdropContributor = await provider.connection.requestAirdrop(contributor.publicKey, 2 * LAMPORTS_PER_SOL);
    const airdropUnauthorized = await provider.connection.requestAirdrop(unauthorizedActor.publicKey, 2 * LAMPORTS_PER_SOL);
    const airdropArbitrator = await provider.connection.requestAirdrop(arbitrator.publicKey, 2 * LAMPORTS_PER_SOL);

    const latestBlockhash = await provider.connection.getLatestBlockhash();
    await provider.connection.confirmTransaction({
      signature: airdropSponsor,
      ...latestBlockhash,
    });

    [bountyPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("bounty"), sponsor.publicKey.toBuffer(), bountyId.toArrayLike(Buffer, "le", 8)],
      program.programId
    );

    [vaultPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("vault"), bountyPda.toBuffer()],
      program.programId
    );
  });

  it("1. Successfully initializes a campus bounty with PDA lamport lockup", async () => {
    const currentTimestamp = Math.floor(Date.now() / 1000);
    const deadline = new anchor.BN(currentTimestamp + 3600); // +1 hour

    await program.methods
      .initializeBounty(bountyId, "KUBG Hackathon Protocol Track MVP", bountyAmount, deadline)
      .accounts({
        bounty: bountyPda,
        vault: vaultPda,
        contributor: contributor.publicKey,
        arbitrator: arbitrator.publicKey,
        sponsor: sponsor.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([sponsor])
      .rpc();

    const bountyAccount = await program.account.bounty.fetch(bountyPda);
    expect(bountyAccount.bountyId.toString()).to.equal(bountyId.toString());
    expect(bountyAccount.sponsor.toBase58()).to.equal(sponsor.publicKey.toBase58());
    expect(bountyAccount.contributor.toBase58()).to.equal(contributor.publicKey.toBase58());
    expect(bountyAccount.amount.toString()).to.equal(bountyAmount.toString());

    const vaultBalance = await provider.connection.getBalance(vaultPda);
    expect(vaultBalance).to.equal(bountyAmount.toNumber());
  });

  it("2. Rejects milestone submission from unauthorized attacker", async () => {
    const dummyHash = Array.from(crypto.randomBytes(32));

    try {
      await program.methods
        .submitMilestone(dummyHash)
        .accounts({
          bounty: bountyPda,
          contributor: unauthorizedActor.publicKey,
        })
        .signers([unauthorizedActor])
        .rpc();
      expect.fail("Should have thrown unauthorized error");
    } catch (err: any) {
      expect(err.toString()).to.include("Unauthorized");
    }
  });

  it("3. Contributor successfully commits deliverable hash", async () => {
    const validHash = Array.from(crypto.createHash("sha256").update("github.com/kubg/submission").digest());

    await program.methods
      .submitMilestone(validHash)
      .accounts({
        bounty: bountyPda,
        contributor: contributor.publicKey,
      })
      .signers([contributor])
      .rpc();

    const bountyAccount = await program.account.bounty.fetch(bountyPda);
    expect(bountyAccount.deliverableHash).to.deep.equal(validHash);
    expect(bountyAccount.status).to.deep.equal({ submitted: {} });
  });

  it("4. Prevents premature timeout refund while submitted milestone is pending review", async () => {
    try {
      await program.methods
        .claimTimeoutRefund()
        .accounts({
          bounty: bountyPda,
          vault: vaultPda,
          sponsor: sponsor.publicKey,
        })
        .signers([sponsor])
        .rpc();
      expect.fail("Should have blocked refund request");
    } catch (err: any) {
      expect(err.toString()).to.include("DeadlineNotPassed");
    }
  });

  it("5. Sponsor approves deliverable, triggering instant lamport payout", async () => {
    const contributorPreBalance = await provider.connection.getBalance(contributor.publicKey);

    await program.methods
      .approveAndDisburse()
      .accounts({
        bounty: bountyPda,
        vault: vaultPda,
        contributor: contributor.publicKey,
        sponsor: sponsor.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([sponsor])
      .rpc();

    const contributorPostBalance = await provider.connection.getBalance(contributor.publicKey);
    expect(contributorPostBalance - contributorPreBalance).to.equal(bountyAmount.toNumber());

    const bountyAccount = await program.account.bounty.fetch(bountyPda);
    expect(bountyAccount.status).to.deep.equal({ completed: {} });

    const vaultBalance = await provider.connection.getBalance(vaultPda);
    expect(vaultBalance).to.equal(0);
  });

  it("6. Rejects duplicate disbursement or replay attack", async () => {
    try {
      await program.methods
        .approveAndDisburse()
        .accounts({
          bounty: bountyPda,
          vault: vaultPda,
          contributor: contributor.publicKey,
          sponsor: sponsor.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([sponsor])
        .rpc();
      expect.fail("Disbursement should fail on completed status");
    } catch (err: any) {
      expect(err.toString()).to.include("InvalidStatusTransition");
    }
  });
});