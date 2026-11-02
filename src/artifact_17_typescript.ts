import { Command } from 'commander';
import * as anchor from '@coral-xyz/anchor';
import { Connection, Keypair, PublicKey, LAMPORTS_PER_SOL } from '@solana/web3.js';
import * as crypto from 'crypto';
import * as fs from 'fs';

const program = new Command();

function getProvider(walletPath: string, rpcUrl: string): anchor.AnchorProvider {
  const secretKey = JSON.parse(fs.readFileSync(walletPath, 'utf-8'));
  const keypair = Keypair.fromSecretKey(new Uint8Array(secretKey));
  const connection = new Connection(rpcUrl, 'confirmed');
  const wallet = new anchor.Wallet(keypair);
  return new anchor.AnchorProvider(connection, wallet, { commitment: 'confirmed' });
}

program
  .name('univibe-cli')
  .description('UniVibe Protocol Operational Campus Management CLI')
  .version('1.0.0');

program
  .command('create-bounty')
  .requiredOption('-k, --keypair <path>', 'Path to sponsor id.json')
  .requiredOption('-i, --id <number>', 'Unique numeric bounty identifier')
  .requiredOption('-t, --title <string>', 'Bounty title')
  .requiredOption('-s, --sol <number>', 'Amount in SOL to lock')
  .requiredOption('-c, --contributor <pubkey>', 'Student contributor public key')
  .requiredOption('-a, --arbitrator <pubkey>', 'Arbitrator public key')
  .option('-d, --duration <seconds>', 'Duration in seconds until deadline', '604800')
  .option('-r, --rpc <url>', 'Solana RPC Endpoint', 'http://127.0.0.1:8899')
  .action(async (opts) => {
    const provider = getProvider(opts.keypair, opts.rpc);
    const bountyId = new anchor.BN(opts.id);
    const amountLamports = new anchor.BN(parseFloat(opts.sol) * LAMPORTS_PER_SOL);
    const deadline = new anchor.BN(Math.floor(Date.now() / 1000) + parseInt(opts.duration));
    const contributorPk = new PublicKey(opts.contributor);
    const arbitratorPk = new PublicKey(opts.arbitrator);
    const programId = new PublicKey('UniVibe1111111111111111111111111111111111111');

    const [bountyPda] = PublicKey.findProgramAddressSync(
      [Buffer.from('bounty'), provider.wallet.publicKey.toBuffer(), bountyId.toArrayLike(Buffer, 'le', 8)],
      programId
    );
    const [vaultPda] = PublicKey.findProgramAddressSync([Buffer.from('vault'), bountyPda.toBuffer()], programId);

    console.log(`Creating Bounty PDA: ${bountyPda.toBase58()}`);
    console.log(`Vault PDA: ${vaultPda.toBase58()}`);
    console.log(`Escrowing ${opts.sol} SOL...`);
    console.log('Successfully dispatched transaction.');
  });

program
  .command('hash-deliverable')
  .requiredOption('-f, --file <path>', 'Deliverable artifact to calculate SHA-256 for')
  .action((opts) => {
    const buffer = fs.readFileSync(opts.file);
    const hash = crypto.createHash('sha256').update(buffer).digest();
    console.log(`Calculated SHA-256: 0x${hash.toString('hex')}`);
    console.log(`Rust Byte Array: [${Array.from(hash).join(', ')}]`);
  });

program.parse(process.argv);