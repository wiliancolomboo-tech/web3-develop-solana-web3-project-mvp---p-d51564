import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Connection, PublicKey, Keypair } from "@solana/web3.js";
import axios from "axios";
import * as fs from "fs";
import * as dotenv from "dotenv";

dotenv.config();

// Program ID definition matching Rust contract
const PROGRAM_ID = new PublicKey("V1BE4aH8bSm3mXyN2r5q8V1BE4aH8bSm3mXyN2r5q8AA");

interface ResendPayload {
  from: string;
  to: string[];
  subject: string;
  html: string;
}

export class UniVibeIntegrationEngine {
  private connection: Connection;
  private program: Program<any>;
  private discordWebhookUrl: string;
  private resendApiKey: string;
  private notificationEmail: string;

  constructor() {
    const rpcUrl = process.env.SOLANA_RPC_URL || "http://127.0.0.1:8899";
    this.connection = new Connection(rpcUrl, "confirmed");

    const keypairPath = process.env.WALLET_PATH || `${process.env.HOME}/.config/solana/id.json`;
    const rawKey = JSON.parse(fs.readFileSync(keypairPath, "utf-8"));
    const keypair = Keypair.fromSecretKey(Uint8Array.from(rawKey));
    const wallet = new anchor.Wallet(keypair);

    const provider = new anchor.AnchorProvider(this.connection, wallet, {
      commitment: "confirmed",
    });
    anchor.setProvider(provider);

    // Load IDL (assuming target/idl/univibe_protocol.json exists)
    const idl = JSON.parse(fs.readFileSync("./target/idl/univibe_protocol.json", "utf8"));
    this.program = new Program(idl, provider);

    this.discordWebhookUrl = process.env.DISCORD_WEBHOOK_URL || "";
    this.resendApiKey = process.env.RESEND_API_KEY || "";
    this.notificationEmail = process.env.CAMPUS_ADMIN_EMAIL || "grants@korea.ac.kr";
  }

  public async startEventListener(): Promise<void> {
    console.log("⚡ [UniVibe Daemon] Connecting to Solana Event Bus on Program:", PROGRAM_ID.toBase58());

    this.program.addEventListener("GrantCreatedEvent", async (event: any, slot: number) => {
      console.log(`\n🎉 [Event: GrantCreated] Slot: ${slot} | Grant: ${event.grant.toBase58()}`);
      await this.dispatchDiscordNotification(
        "🚀 New University Grant Initialized",
        `**Grant Pubkey:** \`${event.grant.toBase58()}\`\n` +
        `**Sponsor:** \`${event.sponsor.toBase58()}\`\n` +
        `**Recipient:** \`${event.recipient.toBase58()}\`\n` +
        `**Total Allocation:** ${event.totalAmount.toNumber() / 1e9} SOL\n` +
        `**Milestones Planned:** ${event.totalMilestones}`
      );
    });

    this.program.addEventListener("DeliverableSubmittedEvent", async (event: any, slot: number) => {
      console.log(`\n📦 [Event: DeliverableSubmitted] Milestone: ${event.milestoneIndex}`);
      await this.dispatchDiscordNotification(
        "📝 Milestone Deliverable Submitted for Review",
        `**Grant:** \`${event.grant.toBase58()}\`\n` +
        `**Milestone Index:** #${event.milestoneIndex}\n` +
        `**Deliverable IPFS CID:** [${event.deliverableCid}](https://ipfs.io/ipfs/${event.deliverableCid})`
      );
    });

    this.program.addEventListener("MilestoneDisbursedEvent", async (event: any, slot: number) => {
      console.log(`\n💰 [Event: MilestoneDisbursed] Milestone #${event.milestoneIndex} released!`);
      const solAmount = event.amount.toNumber() / 1e9;

      await this.dispatchDiscordNotification(
        "💸 Milestone Payout Released!",
        `**Recipient:** \`${event.recipient.toBase58()}\`\n` +
        `**Milestone #${event.milestoneIndex} Paid:** ${solAmount} SOL\n` +
        `**Grant Finalized:** ${event.isGrantCompleted ? "YES ✅" : "NO (Pending next phase) ⏳"}`
      );

      await this.sendFormalEmailReceipt(
        this.notificationEmail,
        `[KUBG UniVibe] Milestone #${event.milestoneIndex} Disbursement Notice`,
        `<h2>Milestone Disbursement Confirmation</h2>
         <p>The milestone payment has cleared on-chain via the UniVibe protocol.</p>
         <ul>
           <li><strong>Grant PDA:</strong> ${event.grant.toBase58()}</li>
           <li><strong>Amount Disbursed:</strong> ${solAmount} SOL</li>
           <li><strong>Recipient:</strong> ${event.recipient.toBase58()}</li>
           <li><strong>Grant Complete:</strong> ${event.isGrantCompleted}</li>
         </ul>
         <p>Inspect state directly on Solana Explorer.</p>`
      );
    });

    console.log("✅ [UniVibe Daemon] Active and listening for on-chain events...");
  }

  private async dispatchDiscordNotification(title: string, description: string): Promise<void> {
    if (!this.discordWebhookUrl) {
      console.warn("⚠️ [Webhook] Discord URL not set. Skipping push.");
      return;
    }
    try {
      await axios.post(this.discordWebhookUrl, {
        embeds: [
          {
            title,
            description,
            color: 0x9945ff, // Solana Purple
            footer: { text: "UniVibe Protocol Engine • KUBG Vibeathon" },
            timestamp: new Date().toISOString(),
          },
        ],
      });
      console.log("📨 [Webhook] Discord embed delivered.");
    } catch (err: any) {
      console.error("❌ [Webhook Error]:", err.message);
    }
  }

  private async sendFormalEmailReceipt(to: string, subject: string, html: string): Promise<void> {
    if (!this.resendApiKey) {
      console.warn("⚠️ [Resend API] Key not set. Skipping email dispatch.");
      return;
    }
    try {
      const payload: ResendPayload = {
        from: "UniVibe Grants <grants@univibe.network>",
        to: [to],
        subject,
        html,
      };

      await axios.post("https://api.resend.com/emails", payload, {
        headers: {
          Authorization: `Bearer ${this.resendApiKey}`,
          "Content-Type": "application/json",
        },
      });
      console.log(`📧 [Resend] Dispatched audit email to ${to}`);
    } catch (err: any) {
      console.error("❌ [Resend Error]:", err.response?.data || err.message);
    }
  }
}

// Execution Entrypoint
if (require.main === module) {
  const daemon = new UniVibeIntegrationEngine();
  daemon.startEventListener().catch((err) => {
    console.error("Fatal Daemon Failure:", err);
    process.exit(1);
  });
}