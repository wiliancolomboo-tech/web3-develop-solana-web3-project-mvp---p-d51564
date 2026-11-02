import { Connection, PublicKey } from "@solana/web3.js";
import { Program, AnchorProvider, Wallet } from "@coral-xyz/anchor";
import http from "http";
import { CONFIG } from "./config";
import { sendDiscordAlert } from "./notify/discord";
import { sendEmailNotification } from "./notify/resend";

const connection = new Connection(CONFIG.SOLANA_RPC_URL, {
  wsEndpoint: CONFIG.SOLANA_WS_URL,
  commitment: "confirmed",
});

// Minimal placeholder wallet for read-only provider
const dummyKeypair = {
  publicKey: PublicKey.default,
  signTransaction: async (tx: any) => tx,
  signAllTransactions: async (txs: any) => txs,
};
const provider = new AnchorProvider(connection, dummyKeypair as unknown as Wallet, {});

// In-line IDL definition for event parsing
const IDL: any = {
  version: "0.1.0",
  name: "unistream",
  events: [
    {
      name: "PoolInitialized",
      fields: [
        { name: "pool", type: "publicKey" },
        { name: "authority", type: "publicKey" },
        { name: "poolId", type: "u64" },
        { name: "name", type: "string" },
        { name: "timestamp", type: "i64" },
      ],
    },
    {
      name: "GrantCreated",
      fields: [
        { name: "grant", type: "publicKey" },
        { name: "pool", type: "publicKey" },
        { name: "grantee", type: "publicKey" },
        { name: "totalAmount", type: "u64" },
        { name: "startTime", type: "i64" },
        { name: "endTime", type: "i64" },
        { name: "milestoneCount", type: "u8" },
        { name: "timestamp", type: "i64" },
      ],
    },
    {
      name: "MilestoneApproved",
      fields: [
        { name: "grant", type: "publicKey" },
        { name: "reviewer", type: "publicKey" },
        { name: "milestoneIndex", type: "u8" },
        { name: "timestamp", type: "i64" },
      ],
    },
    {
      name: "FundsClaimed",
      fields: [
        { name: "grant", type: "publicKey" },
        { name: "grantee", type: "publicKey" },
        { name: "amount", type: "u64" },
        { name: "totalClaimed", type: "u64" },
        { name: "timestamp", type: "i64" },
      ],
    },
    {
      name: "GrantRevoked",
      fields: [
        { name: "grant", type: "publicKey" },
        { name: "pool", type: "publicKey" },
        { name: "refundedAmount", type: "u64" },
        { name: "timestamp", type: "i64" },
      ],
    },
  ],
};

const program = new Program(IDL, new PublicKey(CONFIG.PROGRAM_ID), provider);

async function startEventListener() {
  console.log(`[UniStream Indexer] Connecting to Solana RPC: ${CONFIG.SOLANA_RPC_URL}`);
  console.log(`[UniStream Indexer] Listening to Program: ${CONFIG.PROGRAM_ID}`);

  program.addEventListener("GrantCreated", async (event: any, slot: number) => {
    console.log(`[Event: GrantCreated] Slot: ${slot}`, event);

    const solAmount = (Number(event.totalAmount) / 1e9).toFixed(4);
    await sendDiscordAlert(
      "🎓 New Campus Grant Stream Initialized!",
      `A new university grant stream has been anchored on Solana.`,
      [
        { name: "Grant PDA", value: `\`${event.grant.toString()}\`` },
        { name: "Grantee Wallet", value: `\`${event.grantee.toString()}\`` },
        { name: "Total Budget", value: `${solAmount} SOL`, inline: true },
        { name: "Milestones", value: `${event.milestoneCount}`, inline: true },
        { name: "Solana Slot", value: `${slot}`, inline: true },
      ]
    );

    await sendEmailNotification(
      `Grant Initialized: ${solAmount} SOL Allocated`,
      `<h2>UniStream Grant Created</h2>
       <p>A new student research grant has been approved and funded.</p>
       <ul>
         <li><strong>Grant PDA:</strong> ${event.grant.toString()}</li>
         <li><strong>Grantee:</strong> ${event.grantee.toString()}</li>
         <li><strong>Amount:</strong> ${solAmount} SOL</li>
         <li><strong>Milestones:</strong> ${event.milestoneCount} milestones</li>
       </ul>
       <p><a href="https://solscan.io/account/${event.grant.toString()}?cluster=devnet">View on Solscan</a></p>`
    );
  });

  program.addEventListener("MilestoneApproved", async (event: any, slot: number) => {
    console.log(`[Event: MilestoneApproved] Slot: ${slot}`, event);

    await sendDiscordAlert(
      "✅ Milestone Verified & Approved!",
      `Reviewer has verified milestone delivery. Additional streamed funds have unlocked.`,
      [
        { name: "Grant PDA", value: `\`${event.grant.toString()}\`` },
        { name: "Reviewer", value: `\`${event.reviewer.toString()}\`` },
        { name: "Milestone Index", value: `#${event.milestoneIndex}`, inline: true },
        { name: "Slot", value: `${slot}`, inline: true },
      ]
    );
  });

  program.addEventListener("FundsClaimed", async (event: any, slot: number) => {
    const solClaimed = (Number(event.amount) / 1e9).toFixed(5);
    console.log(`[Event: FundsClaimed] Grant: ${event.grant.toString()} Claimed: ${solClaimed} SOL`);

    await sendDiscordAlert(
      "💸 Streamed Lamports Claimed",
      `Student builder withdrew accrued streaming balance.`,
      [
        { name: "Grant PDA", value: `\`${event.grant.toString()}\`` },
        { name: "Grantee", value: `\`${event.grantee.toString()}\`` },
        { name: "Claimed Amount", value: `${solClaimed} SOL`, inline: true },
      ]
    );
  });

  program.addEventListener("GrantRevoked", async (event: any, slot: number) => {
    const solRefunded = (Number(event.refundedAmount) / 1e9).toFixed(4);
    console.log(`[Event: GrantRevoked] Refunded: ${solRefunded} SOL to pool authority.`);

    await sendDiscordAlert(
      "⚠️ Grant Revoked & Capital Reclaimed",
      `A grant stream was terminated early. Unstreamed balance refunded to university treasury.`,
      [
        { name: "Grant PDA", value: `\`${event.grant.toString()}\`` },
        { name: "Refunded to Treasury", value: `${solRefunded} SOL`, inline: true },
      ]
    );
  });
}

// Liveness/Readiness HTTP Server for Docker & Cloud Orchestration
const server = http.createServer((req, res) => {
  if (req.url === "/healthz" || req.url === "/metrics") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        status: "healthy",
        uptime: process.uptime(),
        network: CONFIG.SOLANA_RPC_URL,
        timestamp: Date.now(),
      })
    );
  } else {
    res.writeHead(404);
    res.end();
  }
});

server.listen(CONFIG.PORT, () => {
  console.log(`[UniStream Telemetry] Health server running on port ${CONFIG.PORT}`);
  startEventListener().catch((err) => {
    console.error("Fatal exception in Event Listener:", err);
    process.exit(1);
  });
});