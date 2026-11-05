// File: src/relayer.ts

import { Connection, PublicKey, Keypair } from "@solana/web3.js";
import { Program, AnchorProvider, Wallet, Idl } from "@coral-xyz/anchor";
import { Resend } from "resend";
import axios from "axios";
import * as dotenv from "dotenv";
import * as crypto from "crypto";

dotenv.config();

// Configuration Interfaces
interface AppConfig {
  rpcUrl: string;
  wsUrl: string;
  programId: PublicKey;
  resendApiKey: string;
  discordWebhookUrl: string;
  notificationEmail: string;
}

const config: AppConfig = {
  rpcUrl: process.env.SOLANA_RPC_URL || "https://api.devnet.solana.com",
  wsUrl: process.env.SOLANA_WS_URL || "wss://api.devnet.solana.com",
  programId: new PublicKey(process.env.PROGRAM_ID || "UniVibe1111111111111111111111111111111111111"),
  resendApiKey: process.env.RESEND_API_KEY || "re_test_000000000000000000000000",
  discordWebhookUrl: process.env.DISCORD_WEBHOOK_URL || "",
  notificationEmail: process.env.CAMPUS_ADMIN_EMAIL || "kubg.solana@korea.ac.kr",
};

const resend = new Resend(config.resendApiKey);

// Setup Web3 Connection
const connection = new Connection(config.rpcUrl, {
  wsEndpoint: config.wsUrl,
  commitment: "confirmed",
});

/**
 * Enterprise Dispatcher: Sends Discord Webhook Notification
 */
async function notifyDiscord(title: string, description: string, color: number = 0x14f195) {
  if (!config.discordWebhookUrl) {
    console.log(`[STUB DISCORD] ${title}: ${description}`);
    return;
  }
  try {
    await axios.post(config.discordWebhookUrl, {
      embeds: [
        {
          title: `🎓 UniVibe Protocol | ${title}`,
          description,
          color,
          timestamp: new Date().toISOString(),
          footer: { text: "KUBG UNI Vibeathon Production Relayer" },
        },
      ],
    });
    console.log(`[DISCORD] Successfully notified: ${title}`);
  } catch (err: any) {
    console.error(`[DISCORD ERROR] Failed to push webhook:`, err.message);
  }
}

/**
 * Enterprise Dispatcher: Sends Transactional Email via Resend
 */
async function sendEmailReceipt(recipient: string, bountyId: string, amountSol: string, txSig: string) {
  if (!config.resendApiKey || config.resendApiKey === "re_test_000000000000000000000000") {
    console.log(`[STUB EMAIL] To: ${recipient} | Bounty: ${bountyId} | Amount: ${amountSol} SOL`);
    return;
  }
  try {
    const { data, error } = await resend.emails.send({
      from: "UniVibe System <onboarding@resend.dev>",
      to: [recipient],
      subject: `[Settlement Complete] UniVibe Bounty #${bountyId} Disbursed`,
      html: `
        <div style="font-family: Arial, sans-serif; padding: 20px; background: #0c0d14; color: #ffffff; border-radius: 8px;">
          <h2 style="color: #14F195;">UniVibe Campus Escrow Settled</h2>
          <p>Congratulations! Your bounty milestone has been verified on Solana.</p>
          <hr style="border: 1px solid #232738;" />
          <p><strong>Bounty ID:</strong> ${bountyId}</p>
          <p><strong>Disbursed Amount:</strong> ${amountSol} SOL</p>
          <p><strong>Explorer Proof:</strong> <a href="https://explorer.solana.com/tx/${txSig}?cluster=devnet" style="color: #9945FF;">View on Solana Explorer</a></p>
          <p style="font-size: 12px; color: #888;">Korea University Blockchain Group (KUBG) UNI Vibeathon Hackathon Infrastructure</p>
        </div>
      `,
    });
    if (error) console.error("[RESEND ERROR]", error);
    else console.log(`[RESEND SUCCESS] Sent receipt ID: ${data?.id}`);
  } catch (err: any) {
    console.error(`[RESEND EXCEPTION]`, err.message);
  }
}

/**
 * Stream & Parse Program Transaction Logs
 */
async function startDaemon() {
  console.log("=================================================");
  console.log("   UniVibe Enterprise Off-Chain Automation Engine");
  console.log(`   Target Program: ${config.programId.toBase58()}`);
  console.log("=================================================");

  connection.onLogs(
    config.programId,
    async ({ logs, err, signature }) => {
      if (err) return;

      const logString = logs.join(" ");

      // Catch Bounty Initialization
      if (logString.includes("Instruction: InitializeBounty")) {
        console.log(`[CHAIN EVENT] New Bounty Created: Tx ${signature}`);
        await notifyDiscord(
          "🌟 New Campus Bounty Deployed!",
          `A new research/development bounty has been escrowed on-chain.\n**Transaction Signature:** \`${signature}\``,
          0x9945ff
        );
      }

      // Catch Milestone Submission
      if (logString.includes("Instruction: SubmitMilestone")) {
        console.log(`[CHAIN EVENT] Milestone Submitted: Tx ${signature}`);
        await notifyDiscord(
          "📥 Submission Received",
          `A student contributor submitted proof of completion.\n**Review Required.**\nTx: \`${signature}\``,
          0xffaa00
        );
      }

      // Catch Release Bounty
      if (logString.includes("Instruction: ReleaseBounty")) {
        console.log(`[CHAIN EVENT] Bounty Released: Tx ${signature}`);
        await notifyDiscord(
          "💰 Bounty Successfully Paid Out!",
          `Funds unlocked and transferred to student wallet.\nTx: \`${signature}\``,
          0x14f195
        );
        await sendEmailReceipt(config.notificationEmail, "LIVE-ESCROW", "Active", signature);
      }
    },
    "confirmed"
  );

  console.log("[STATUS] Listening for Solana cluster logs...");
}

// Auto-run if main module
if (require.main === module) {
  startDaemon().catch((err) => {
    console.error("Fatal Daemon Error:", err);
    process.exit(1);
  });
}

export { notifyDiscord, sendEmailReceipt, config };