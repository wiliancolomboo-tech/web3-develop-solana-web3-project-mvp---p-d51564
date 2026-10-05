import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { CampusPulse } from "../target/types/campus_pulse";
import { PublicKey, Keypair, SystemProgram, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { expect } from "chai";

describe("CampusPulse Protocol - Integration QA Suite", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.CampusPulse as Program<CampusPulse>;

  const sponsor = Keypair.generate();
  const recipient = Keypair.generate();
  const reviewer = Keypair.generate();
  const unauthorizedUser = Keypair.generate();

  const grantId = new anchor.BN(Date.now());
  const totalBudget = new anchor.BN(2 * LAMPORTS_PER_SOL); // 2 SOL
  const milestoneCount = 2;

  let grantPda: PublicKey;
  let vaultPda: PublicKey;

  before(async () => {
    // Airdrop SOL to test actors
    const airdropSigners = [sponsor, recipient, reviewer, unauthorizedUser];
    for (const actor of airdropSigners) {
      const sig = await provider.connection.requestAirdrop(actor.publicKey, 5 * LAMPORTS_PER_SOL);
      await provider.connection.confirmTransaction(sig, "confirmed");
    }

    [grantPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("grant"), grantId.toArrayLike(Buffer, "le", 8)],
      program.programId
    );

    [vaultPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("vault"), grantId.toArrayLike(Buffer, "le", 8)],
      program.programId
    );
  });

  it("1. Initializes a Grant with valid PDAs and funds the vault", async () => {
    const title = "KUBG AI x Solana Agent";

    await program.methods
      .initializeGrant(grantId, title, totalBudget, milestoneCount)
      .accounts({
        grant: grantPda,
        vault: vaultPda,
        sponsor: sponsor.publicKey,
        recipient: recipient.publicKey,
        reviewer: reviewer.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([sponsor])
      .rpc();

    const grantAccount = await program.account.grant.fetch(grantPda);
    expect(grantAccount.grantId.toString()).to.equal(grantId.toString());
    expect(grantAccount.totalBudget.toString()).to.equal(totalBudget.toString());
    expect(grantAccount.remainingBalance.toString()).to.equal(totalBudget.toString());
    expect(grantAccount.currentMilestone).to.equal(0);
    expect(grantAccount.milestoneCount).to.equal(2);
    expect(grantAccount.title).to.equal(title);

    // Verify Vault Lamport balance equals totalBudget
    const vaultBalance = await provider.connection.getBalance(vaultPda);
    expect(vaultBalance).to.equal(totalBudget.toNumber());
  });

  it("2. Blocks unauthorized actors from submitting milestones", async () => {
    try {
      await program.methods
        .submitMilestone(grantId, 0, "https://github.com/kubg/milestone-1")
        .accounts({
          grant: grantPda,
          recipient: unauthorizedUser.publicKey,
        })
        .signers([unauthorizedUser])
        .rpc();
      expect.fail("Should have thrown unauthorized error");
    } catch (err: any) {
      expect(err.error?.errorCode?.code || err.message).to.include("UnauthorizedRecipient");
    }
  });

  it("3. Successfully submits milestone 0 by the recipient", async () => {
    const proofUri = "https://github.com/kubg/milestone-1-mvp";

    await program.methods
      .submitMilestone(grantId, 0, proofUri)
      .accounts({
        grant: grantPda,
        recipient: recipient.publicKey,
      })
      .signers([recipient])
      .rpc();

    const grantAccount = await program.account.grant.fetch(grantPda);
    expect(grantAccount.state).to.deep.equal({ submitted: {} });
  });

  it("4. Rejects milestone review from non-reviewer actor", async () => {
    try {
      await program.methods
        .reviewMilestone(grantId, 0, true)
        .accounts({
          grant: grantPda,
          reviewer: unauthorizedUser.publicKey,
        })
        .signers([unauthorizedUser])
        .rpc();
      expect.fail("Should fail with UnauthorizedReviewer");
    } catch (err: any) {
      expect(err.error?.errorCode?.code || err.message).to.include("UnauthorizedReviewer");
    }
  });

  it("5. Reviewer approves milestone 0", async () => {
    await program.methods
      .reviewMilestone(grantId, 0, true)
      .accounts({
        grant: grantPda,
        reviewer: reviewer.publicKey,
      })
      .signers([reviewer])
      .rpc();

    const grantAccount = await program.account.grant.fetch(grantPda);
    expect(grantAccount.state).to.deep.equal({ approved: {} });
  });

  it("6. Disburses milestone 0 tranche (1 SOL) to the recipient", async () => {
    const recipientBalanceBefore = await provider.connection.getBalance(recipient.publicKey);

    await program.methods
      .disburseMilestone(grantId, 0)
      .accounts({
        grant: grantPda,
        vault: vaultPda,
        recipient: recipient.publicKey,
        caller: sponsor.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([sponsor])
      .rpc();

    const recipientBalanceAfter = await provider.connection.getBalance(recipient.publicKey);
    expect(recipientBalanceAfter - recipientBalanceBefore).to.equal(1 * LAMPORTS_PER_SOL);

    const grantAccount = await program.account.grant.fetch(grantPda);
    expect(grantAccount.currentMilestone).to.equal(1);
    expect(grantAccount.remainingBalance.toNumber()).to.equal(1 * LAMPORTS_PER_SOL);
    expect(grantAccount.state).to.deep.equal({ active: {} });
  });

  it("7. Executes dispute and emergency clawback flow for milestone 1", async () => {
    // Recipient submits milestone 1
    await program.methods
      .submitMilestone(grantId, 1, "https://github.com/kubg/milestone-2-broken")
      .accounts({
        grant: grantPda,
        recipient: recipient.publicKey,
      })
      .signers([recipient])
      .rpc();

    // Reviewer rejects milestone 1
    await program.methods
      .reviewMilestone(grantId, 1, false)
      .accounts({
        grant: grantPda,
        reviewer: reviewer.publicKey,
      })
      .signers([reviewer])
      .rpc();

    let grantAccount = await program.account.grant.fetch(grantPda);
    expect(grantAccount.state).to.deep.equal({ disputed: {} });

    // Sponsor triggers emergency clawback
    const sponsorBalanceBefore = await provider.connection.getBalance(sponsor.publicKey);

    await program.methods
      .emergencyClawback(grantId)
      .accounts({
        grant: grantPda,
        vault: vaultPda,
        sponsor: sponsor.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([sponsor])
      .rpc();

    const sponsorBalanceAfter = await provider.connection.getBalance(sponsor.publicKey);
    expect(sponsorBalanceAfter).to.be.greaterThan(sponsorBalanceBefore);

    grantAccount = await program.account.grant.fetch(grantPda);
    expect(grantAccount.state).to.deep.equal({ cancelled: {} });
    expect(grantAccount.remainingBalance.toNumber()).to.equal(0);
  });
});