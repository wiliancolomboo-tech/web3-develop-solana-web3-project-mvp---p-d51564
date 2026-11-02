import { Connection, PublicKey } from '@solana/web3.js';
import * as anchor from '@coral-xyz/anchor';
import dotenv from 'dotenv';
import { logger, sendDiscordAuditAlert, sendEmailNotification } from './telemetry';

dotenv.config();

const RPC_URL = process.env.SOLANA_RPC_URL || 'http://127.0.0.1:8899';
const PROGRAM_ID = new PublicKey(process.env.PROGRAM_ID || 'UniVibe1111111111111111111111111111111111111');

// Minimal IDL interface mapping for programmatic event consumption
const IDL: anchor.Idl = {
  version: '0.1.0',
  name: 'univibe_engine',
  instructions: [],
  events: [
    {
      name: 'BountyInitialized',
      fields: [
        { name: 'bountyId', type: 'u64', index: false },
        { name: 'sponsor', type: 'publicKey', index: false },
        { name: 'contributor', type: 'publicKey', index: false },
        { name: 'amount', type: 'u64', index: false },
        { name: 'deadlineTimestamp', type: 'i64', index: false },
        { name: 'title', type: 'string', index: false },
      ],
    },
    {
      name: 'MilestoneSubmitted',
      fields: [
        { name: 'bountyId', type: 'u64', index: false },
        { name: 'contributor', type: 'publicKey', index: false },
        { name: 'deliverableHash', type: { array: ['u8', 32] }, index: false },
        { name: 'submittedAt', type: 'i64', index: false },
      ],
    },
    {
      name: 'FundsDisbursed',
      fields: [
        { name: 'bountyId', type: 'u64', index: false },
        { name: 'contributor', type: 'publicKey', index: false },
        { name: 'amount', type: 'u64', index: false },
        { name: 'disbursedAt', type: 'i64', index: false },
      ],
    },
  ],
};

async function startDaemon() {
  logger.info(`Starting UniVibe Enterprise Daemon on RPC: ${RPC_URL}`);
  const connection = new Connection(RPC_URL, { wsEndpoint: RPC_URL.replace('http', 'ws'), commitment: 'confirmed' });
  const provider = new anchor.AnchorProvider(connection, new anchor.Wallet(anchor.web3.Keypair.generate()), {
    commitment: 'confirmed',
  });
  const program = new anchor.Program(IDL, PROGRAM_ID, provider);

  logger.info(`Listening for on-chain events emitted by: ${PROGRAM_ID.toBase58()}`);

  // 1. Bounty Initialized Listener
  program.addEventListener('BountyInitialized', async (event: any, slot: number) => {
    logger.info(`[Event] Bounty Initialized: #${event.bountyId.toString()} - "${event.title}"`);
    await sendDiscordAuditAlert('New Bounty Funded & Escrowed', `A new campus grant has been locked in Solana escrow.`, [
      { name: 'Bounty ID', value: `#${event.bountyId.toString()}` },
      { name: 'Title', value: event.title },
      { name: 'Amount (SOL)', value: (Number(event.amount) / 1e9).toFixed(4) },
      { name: 'Sponsor', value: event.sponsor.toBase58() },
      { name: 'Target Contributor', value: event.contributor.toBase58() },
    ]);
  });

  // 2. Milestone Submitted Listener
  program.addEventListener('MilestoneSubmitted', async (event: any, slot: number) => {
    const hexHash = Buffer.from(event.deliverableHash).toString('hex');
    logger.info(`[Event] Milestone Submitted: Bounty #${event.bountyId.toString()} | Deliverable: ${hexHash.slice(0, 10)}...`);
    
    await sendDiscordAuditAlert('Milestone Submitted by Contributor', `Deliverable submitted on-chain for review.`, [
      { name: 'Bounty ID', value: `#${event.bountyId.toString()}` },
      { name: 'Contributor', value: event.contributor.toBase58() },
      { name: 'SHA-256 Checksum', value: `\`${hexHash}\`` },
    ]);

    // Student Alert via Resend
    await sendEmailNotification(
      'campus-sponsor@korea.ac.kr',
      `[Action Required] Milestone Submitted for Bounty #${event.bountyId.toString()}`,
      `<h2>Student Deliverable Submitted</h2><p>Student <code>${event.contributor.toBase58()}</code> has submitted deliverable hash <code>${hexHash}</code>.</p><p>Please approve disbursement via the UniVibe portal.</p>`
    );
  });

  // 3. Funds Disbursed Listener
  program.addEventListener('FundsDisbursed', async (event: any, slot: number) => {
    const solFormatted = (Number(event.amount) / 1e9).toFixed(4);
    logger.info(`[Event] Lamports Released: ${solFormatted} SOL -> ${event.contributor.toBase58()}`);

    await sendDiscordAuditAlert('Escrow Settlement Complete', `Bounty funds released instantly to contributor.`, [
      { name: 'Bounty ID', value: `#${event.bountyId.toString()}` },
      { name: 'Amount Paid', value: `${solFormatted} SOL` },
      { name: 'Recipient', value: event.contributor.toBase58() },
    ]);

    await sendEmailNotification(
      'student-lead@korea.ac.kr',
      `[UniVibe] Payment Disbursed: ${solFormatted} SOL Received!`,
      `<h2>Milestone Approved!</h2><p>Your submission for Bounty #${event.bountyId.toString()} has been approved. <b>${solFormatted} SOL</b> was transferred directly to your Solana wallet.</p>`
    );
  });
}

startDaemon().catch((err) => {
  logger.error(`Fatal Daemon Crash: ${err}`);
  process.exit(1);
});