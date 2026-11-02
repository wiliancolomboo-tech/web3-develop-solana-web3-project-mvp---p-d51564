# 1. Build optimized BPF program
anchor build

# 2. Synchronize Program ID keypair with declare_id!
anchor keys sync

# 3. Deploy to Solana Devnet
solana config set --url https://api.devnet.solana.com
solana airdrop 2
anchor deploy --provider.cluster devnet

# 4. Initialize Campus Endowment Pool via Anchor Client
yarn ts-node scripts/init-pool.ts \
  --name "KUBG-UNI-VIBE-2025" \
  --ceiling 5000000000 \
  --quorum 5 \
  --deposit 10000000000