import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Campusvibe } from "../target/types/campusvibe";
import { PublicKey, Keypair, SystemProgram, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { expect } from "chai";

describe("campusvibe e2e test suite", () => {
    const provider = anchor.AnchorProvider.env();
    anchor.setProvider(provider);

    const program = anchor.workspace.Campusvibe as Program<Campusvibe>;

    const sponsor = Keypair.generate();
    const student = Keypair.generate();
    const reviewer1 = Keypair.generate();
    const reviewer2 = Keypair.generate();

    const bountyId = new anchor.BN(Date.now());
    const totalBountyAmount = new anchor.BN(2 * LAMPORTS_PER_SOL);
    const milestoneReward = new anchor.BN(1 * LAMPORTS_PER_SOL);
    const quorumRequired = 2;

    let bountyPda: PublicKey;
    let vaultPda: PublicKey;
    let milestonePda: PublicKey;

    before(async () => {
        // Airdrop funds to actors
        for (const actor of [sponsor, student, reviewer1, reviewer2]) {
            const sig = await provider.connection.requestAirdrop(actor.publicKey, 10 * LAMPORTS_PER_SOL);
            await provider.connection.confirmTransaction(sig, "confirmed");
        }

        // Derive Bounty PDA
        [bountyPda] = PublicKey.findProgramAddressSync(
            [Buffer.from("bounty"), sponsor.publicKey.toBuffer(), bountyId.toArrayLike(Buffer, "le", 8)],
            program.programId
        );

        // Derive Vault PDA
        [vaultPda] = PublicKey.findProgramAddressSync(
            [Buffer.from("vault"), sponsor.publicKey.toBuffer(), bountyId.toArrayLike(Buffer, "le", 8)],
            program.programId
        );

        // Derive Milestone PDA for index 0
        [milestonePda] = PublicKey.findProgramAddressSync(
            [Buffer.from("milestone"), bountyPda.toBuffer(), Buffer.from([0])],
            program.programId
        );
    });

    it("1. Successfully initializes a bounty and escrows 2 SOL to PDA Vault", async () => {
        const tx = await program.methods
            .initializeBounty(bountyId, "KUBG UNI Vibeathon Top Track", totalBountyAmount, quorumRequired)
            .accounts({
                bounty: bountyPda,
                vault: vaultPda,
                creator: sponsor.publicKey,
                systemProgram: SystemProgram.programId,
            })
            .signers([sponsor])
            .rpc();

        expect(tx).to.be.a("string");

        const vaultBalance = await provider.connection.getBalance(vaultPda);
        expect(vaultBalance).to.equal(totalBountyAmount.toNumber());

        const bountyAccount = await program.account.bounty.fetch(bountyPda);
        expect(bountyAccount.creator.toBase58()).to.equal(sponsor.publicKey.toBase58());
        expect(bountyAccount.remainingAmount.toNumber()).to.equal(totalBountyAmount.toNumber());
        expect(bountyAccount.quorumRequired).to.equal(quorumRequired);
    });

    it("2. Contributor registers milestone #0 proof", async () => {
        await program.methods
            .submitMilestone(0, milestoneReward, "https://github.com/kubg/uni-vibe-submission")
            .accounts({
                bounty: bountyPda,
                milestone: milestonePda,
                contributor: student.publicKey,
                systemProgram: SystemProgram.programId,
            })
            .signers([student])
            .rpc();

        const milestoneAccount = await program.account.milestone.fetch(milestonePda);
        expect(milestoneAccount.contributor.toBase58()).to.equal(student.publicKey.toBase58());
        expect(milestoneAccount.amount.toNumber()).to.equal(milestoneReward.toNumber());
        expect(milestoneAccount.attestationsCount).to.equal(0);
        expect(milestoneAccount.status).to.deep.equal({ underReview: {} });
    });

    it("3. Reviewer 1 attests milestone (Quorum not yet reached)", async () => {
        await program.methods
            .attestMilestone()
            .accounts({
                bounty: bountyPda,
                milestone: milestonePda,
                reviewer: reviewer1.publicKey,
            })
            .signers([reviewer1])
            .rpc();

        const milestoneAccount = await program.account.milestone.fetch(milestonePda);
        expect(milestoneAccount.attestationsCount).to.equal(1);
        expect(milestoneAccount.status).to.deep.equal({ underReview: {} });
    });

    it("4. Prevents Reviewer 1 from double-attesting", async () => {
        try {
            await program.methods
                .attestMilestone()
                .accounts({
                    bounty: bountyPda,
                    milestone: milestonePda,
                    reviewer: reviewer1.publicKey,
                })
                .signers([reviewer1])
                .rpc();
            expect.fail("Should have failed on duplicate review");
        } catch (err: any) {
            expect(err.error.errorCode.code).to.equal("AlreadyAttested");
        }
    });

    it("5. Reviewer 2 attests milestone (Quorum Reached -> Approved)", async () => {
        await program.methods
            .attestMilestone()
            .accounts({
                bounty: bountyPda,
                milestone: milestonePda,
                reviewer: reviewer2.publicKey,
            })
            .signers([reviewer2])
            .rpc();

        const milestoneAccount = await program.account.milestone.fetch(milestonePda);
        expect(milestoneAccount.attestationsCount).to.equal(2);
        expect(milestoneAccount.status).to.deep.equal({ approved: {} });
    });

    it("6. Contributor claims payout; Escrow releases 1 SOL directly", async () => {
        const studentBalBefore = await provider.connection.getBalance(student.publicKey);

        await program.methods
            .claimPayout()
            .accounts({
                bounty: bountyPda,
                milestone: milestonePda,
                vault: vaultPda,
                contributor: student.publicKey,
                systemProgram: SystemProgram.programId,
            })
            .signers([student])
            .rpc();

        const studentBalAfter = await provider.connection.getBalance(student.publicKey);
        expect(studentBalAfter).to.be.greaterThan(studentBalBefore);

        const milestoneAccount = await program.account.milestone.fetch(milestonePda);
        expect(milestoneAccount.status).to.deep.equal({ paid: {} });

        const bountyAccount = await program.account.bounty.fetch(bountyPda);
        expect(bountyAccount.remainingAmount.toNumber()).to.equal(1 * LAMPORTS_PER_SOL);
    });

    it("7. Prevents claiming payout a second time", async () => {
        try {
            await program.methods
                .claimPayout()
                .accounts({
                    bounty: bountyPda,
                    milestone: milestonePda,
                    vault: vaultPda,
                    contributor: student.publicKey,
                    systemProgram: SystemProgram.programId,
                })
                .signers([student])
                .rpc();
            expect.fail("Should have failed claiming already paid milestone");
        } catch (err: any) {
            expect(err.error.errorCode.code).to.equal("InvalidMilestoneStatus");
        }
    });
});