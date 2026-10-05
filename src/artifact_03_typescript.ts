import * as anchor from "@coral-xyz/anchor";
import { Program, Idl } from "@coral-xyz/anchor";
import { Connection, PublicKey, Keypair } from "@solana/web3.js";
import axios from "axios";
import * as dotenv from "dotenv";

dotenv.config();

// Enterprise Configuration Interface
interface AppConfig {
  solanaRpcUrl: string;
  solanaWsUrl: string;
  programId: PublicKey;
  discordWebhookUrl?: string;
  resendApiKey?: string;
  resendSenderEmail?: string;
  sponsorAlertEmail?: string;
}

const config: AppConfig = {
  solanaRpcUrl: process.env.SOLANA_RPC_URL || "https://api.devnet.solana.com",
  solanaWsUrl: process.env.SOLANA_WS_URL || "wss://api.devnet.solana.com",
  programId: new PublicKey(process.env.PROGRAM_ID || "CmpP1seVibe111111111111111111111111111111111"),
  discordWebhookUrl: process.env.DISCORD_WEBHOOK_URL,
  resendApiKey: process.env.RESEND_API_KEY,
  resendSenderEmail: process.env.RESEND_SENDER_EMAIL || "grants@campuspulse.org",
  sponsorAlertEmail: process.env.SPONSOR_ALERT_EMAIL || "committee@kubg.io",
};

/**
 * Enterprise Dispatcher: Sends Discord Embed and Email notifications via Resend API
 */
class NotificationDispatcher {
  public static async dispatchDiscordAlert(title: string, fields: { name: string; value: string; inline?: boolean }[]) {
    if (!config.discordWebhookUrl) {
      console.log(`[DISCORD_SKIP] Webhook URL not configured. Title: ${title}`);
      return;
    }

    try {
      await axios.post(config.discordWebhookUrl, {
        username: "CampusPulse Protocol Sentinel",
        avatar_url: "https://solana.com/src/img/branding/solanaLogoMark.png",
        embeds: [
          {
            title: `⚡ ${title}`,
            color: 0x14f195, // Solana Emerald Green
            fields,
            timestamp: new Date().toISOString(),
            footer: {
              text: "Solana KUBG UNI Vibeathon Engine • Verifiable On-Chain State",
            },
          },
        ],
      });
      console.log(`[DISCORD_SUCCESS] Dispatched alert: "${title}"`);
    } catch (err: any) {
      console.error(`[DISCORD_ERROR] Failed to post webhook: ${err.message}`);
    }
  }

  public static async dispatchEmailReceipt(recipientEmail: string, subject: string, htmlContent: string) {
    if (!config.resendApiKey) {
      console.log(`[RESEND_SKIP] API key not configured. Subject: ${subject}`);
      return;
    }

    try {
      const response = await axios.post(
        "https://api.resend.com/emails",
        {
          from: `CampusPulse Grants <${config.resendSenderEmail}>`,
          to: [recipientEmail],
          subject,
          html: htmlContent,
        },
        {
          headers: {
            Authorization: `Bearer ${config.resendApiKey}`,
            "Content-Type": "application/json",
          },
        }
      );
      console.log(`[RESEND_SUCCESS] Email dispatched (ID: ${response.data.id}) to ${recipientEmail}`);
    } catch (err: any) {
      console.error(`[RESEND_ERROR] Email dispatch failed: ${err.response?.data?.message || err.message}`);
    }
  }
}

/**
 * CampusPulse Sentinel: Real-time event subscription daemon
 */
export class CampusPulseSentinel {
  private connection: Connection;
  private program: Program;

  constructor(idl: Idl, keypair: Keypair) {
    this.connection = new Connection(config.solanaRpcUrl, {
      wsEndpoint: config.solanaWsUrl,
      commitment: "confirmed",
    });

    const wallet = new anchor.Wallet(keypair);
    const provider = new anchor.AnchorProvider(this.connection, wallet, { commitment: "confirmed" });
    this.program = new Program(idl, config.programId, provider);
  }

  public async startListener(): Promise<void> {
    console.log("==========================================================");
    console.log("   CAMPUSPULSE SENTINEL DAEMON ONLINE [Solana Ecosystem]  ");
    console.log(`   Program ID: ${config.programId.toBase58()}`);
    console.log(`   RPC Endpoint: ${config.solanaRpcUrl}`);
    console.log("==========================================================");

    // Subscribe to MilestoneDisbursed Event
    this.program.addEventListener("MilestoneDisbursed", async (event: any, slot: number, signature: string) => {
      const grantId = event.grantId.toString();
      const milestoneIndex = event.milestoneIndex;
      const lamports = event.amount.toNumber();
      const solAmount = (lamports / 1e9).toFixed(4);
      const recipient = event.recipient.toBase58();

      console.log(`\n🎉 [EVENT DETECTED] MilestoneDisbursed: Grant #${grantId}, Milestone ${milestoneIndex}, Amount: ${solAmount} SOL`);

      // 1. Post to Campus Discord / Slack Channel
      await NotificationDispatcher.dispatchDiscordAlert(`Grant Milestone Capital Disbursed!`, [
        { name: "Grant ID", value: `#${grantId}`, inline: true },
        { name: "Milestone Index", value: `#${milestoneIndex + 1}`, inline: true },
        { name: "Amount Disbursed", value: `${solAmount} SOL`, inline: true },
        { name: "Recipient Address", value: `\`${recipient}\``, inline: false },
        { name: "Solana Explorer Link", value: `[View Transaction](https://explorer.solana.com/tx/${signature}?cluster=devnet)`, inline: false },
      ]);

      // 2. Dispatch Enterprise Email Receipt
      const emailBody = `
        <div style="font-family: Arial, sans-serif; background: #0b0e14; color: #f3f4f6; padding: 24px; border-radius: 8px;">
          <h2 style="color: #14f195;">CampusPulse Milestone Disbursement Receipt</h2>
          <p>This automated receipt confirms an on-chain grant disbursement execution under KUBG UNI Vibeathon.</p>
          <table style="width: 100%; border-collapse: collapse; margin-top: 16px;">
            <tr><td style="padding: 8px; color: #9ca3af;">Grant ID:</td><td style="padding: 8px; font-weight: bold;">#${grantId}</td></tr>
            <tr><td style="padding: 8px; color: #9ca3af;">Milestone:</td><td style="padding: 8px; font-weight: bold;">Milestone #${milestoneIndex + 1}</td></tr>
            <tr><td style="padding: 8px; color: #9ca3af;">Disbursed Amount:</td><td style="padding: 8px; font-weight: bold; color: #14f195;">${solAmount} SOL</td></tr>
            <tr><td style="padding: 8px; color: #9ca3af;">Recipient:</td><td style="padding: 8px; font-family: monospace;">${recipient}</td></tr>
            <tr><td style="padding: 8px; color: #9ca3af;">Slot Finality:</td><td style="padding: 8px;">${slot}</td></tr>
          </table>
          <p style="margin-top: 24px;">
            <a href="https://explorer.solana.com/tx/${signature}?cluster=devnet" style="background: #14f195; color: #000; padding: 10px 20px; text-decoration: none; font-weight: bold; border-radius: 4px;">Inspect On Solana Explorer</a>
          </p>
        </div>
      `;

      if (config.sponsorAlertEmail) {
        await NotificationDispatcher.dispatchEmailReceipt(
          config.sponsorAlertEmail,
          `[Disbursement Proof] Grant #${grantId} - Milestone #${milestoneIndex + 1} Finalized`,
          emailBody
        );
      }
    });

    // Subscribe to GrantCancelled Event
    this.program.addEventListener("GrantCancelled", async (event: any, _slot: number, signature: string) => {
      console.log(`⚠️ [EVENT DETECTED] Grant #${event.grantId} Cancelled. Clawback executed.`);
      await NotificationDispatcher.dispatchDiscordAlert(`⚠️ Grant Escrow Clawback Executed`, [
        { name: "Grant ID", value: `#${event.grantId.toString()}`, inline: true },
        { name: "Refund Amount", value: `${(event.refundAmount.toNumber() / 1e9).toFixed(4)} SOL`, inline: true },
        { name: "Tx Signature", value: `\`${signature.slice(0, 16)}...\``, inline: false },
      ]);
    });
  }
}

// Standalone execution entrypoint
if (require.main === module) {
  const dummyIdl: any = {
    version: "0.1.0",
    name: "campus_pulse",
    instructions: [],
    events: [
      {
        name: "MilestoneDisbursed",
        fields: [
          { name: "grantId", type: "u64", index: false },
          { name: "milestoneIndex", type: "u8", index: false },
          { name: "amount", type: "u64", index: false },
          { name: "recipient", type: "publicKey", index: false },
        ],
      },
      {
        name: "GrantCancelled",
        fields: [
          { name: "grantId", type: "u64", index: false },
          { name: "refundAmount", type: "u64", index: false },
          { name: "sponsor", type: "publicKey", index: false },
        ],
      },
    ],
  };

  const keypair = Keypair.generate();
  const sentinel = new CampusPulseSentinel(dummyIdl, keypair);
  sentinel.startListener().catch((err) => {
    console.error("Sentinel Daemon Fatal Exception:", err);
    process.exit(1);
  });
}