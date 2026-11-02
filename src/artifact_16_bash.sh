# 1. Clone repository and navigate to root
git clone https://github.com/kubg-vibeathon/univibe-protocol.git
cd univibe-protocol

# 2. Build Anchor Solana Program with verifiable binary output
anchor build

# 3. Synchronize program keys and deploy to Devnet
solana config set --url https://api.devnet.solana.com
solana airdrop 2
anchor deploy --provider.cluster devnet

# 4. Run full deterministic test suite with local validator
anchor test