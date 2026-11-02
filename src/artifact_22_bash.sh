# 1. Clone repository & install dependencies
git clone https://github.com/univibe-solana/univibe-protocol.git
cd univibe-protocol
npm install

# 2. Build Anchor Smart Contracts
anchor build

# 3. Synchronize program keys
solana address -k target/deploy/univibe_engine-keypair.json
# Ensure ID matches declare_id!() in programs/univibe-engine/src/lib.rs

# 4. Run test suite locally
anchor test

# 5. Deploy to Solana Devnet
solana config set --url https://api.devnet.solana.com
solana airdrop 2
anchor deploy --provider.cluster devnet

# 6. Initialize Environment for Off-chain Worker
cp .env.example .env
# Edit .env with your RESEND_API_KEY and DISCORD_WEBHOOK_URL

# 7. Launch Dockerized Daemon
docker-compose up -d --build
docker logs -f univibe_event_daemon