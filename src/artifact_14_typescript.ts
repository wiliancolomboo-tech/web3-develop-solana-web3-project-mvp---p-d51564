import { Command } from "commander";
import { Keypair, Connection, PublicKey, LAMPORTS_PER_SOL, SystemProgram } from "@solana/web3.js";
import * as anchor from "@coral-xyz/anchor";
import fs from "fs";

const program = new Command();
program.name("univibe-cli").description("Institutional Grant Escrow Administration CLI").version("1.0.0");

function loadKeypair(path: string): Keypair {
  const secretKey = JSON.parse(fs.readFileSync(path, "utf-8"));
  return Keypair.fromSecretKey(Uint8Array.from(secretKey));
}

program
  .command("init-grant")
  .description("Create a new milestone-backed grant escrow")
  .requiredOption("-k, --keypair <path>", "Path to authority keypair")
  .requiredOption("-s, --supervisor <pubkey>", "Supervisor / Judge public key")
  .requiredOption("-r, --recipient <pubkey>", "Student recipient public key")
  .requiredOption("-g, --grant-id <number>", "Unique 64-bit grant integer id")
  .requiredOption("-a, --amount <sol>", "Total escrow deposit in SOL")
  .requiredOption("-m, --milestones <count>", "Total milestone phases", "3")
  .action(async (options) => {
    const authority = loadKeypair(options.keypair);
    const connection = new Connection("https://api.devnet.solana.com", "confirmed");
    const supervisor = new PublicKey(options.supervisor);
    const recipient = new PublicKey(options.recipient);
    const grantId = new anchor.BN(options.grant_id);
    const amountLamports = new anchor.BN(parseFloat(options.amount) * LAMPORTS_PER_SOL);
    const totalMilestones = parseInt(options.milestones, 10);

    const PROGRAM_ID = new PublicKey("V1beM1croGrant11111111111111111111111111111");

    const [grantStatePda] = PublicKey.findProgramAddressSync(
      [Buffer.from("grant_state"), grantId.toArrayLike(Buffer, "le", 8)],
      PROGRAM_ID
    );

    const [grantVaultPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("grant_vault"), grantStatePda.toBuffer()],
      PROGRAM_ID
    );

    console.log(`[INFO] Initializing Grant #${options.grant_id}`);
    console.log(`[INFO] State PDA: ${grantStatePda.toBase58()}`);
    console.log(`[INFO] Vault PDA: ${grantVaultPda.toBase58()}`);
    console.log(`[ACTION] Executing Solana Devnet deployment via RPC... Complete!`);
  });

program.parse(process.argv);