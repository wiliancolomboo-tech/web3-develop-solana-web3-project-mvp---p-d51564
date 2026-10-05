# 1. Clone repository & install dependencies
git clone https://github.com/kubg-vibeathon/campuspulse.git
cd campuspulse
yarn install

# 2. Build Anchor Smart Contract (Solana Tool suite >= 1.18.x)
anchor build

# 3. Synchronize Program ID Keys
solana-keygen pubkey target/deploy/campus_pulse-keypair.json
# (Paste output into declare_id!("...") in lib.rs & Anchor.toml)

# 4. Deploy to Solana Devnet
solana config set --url https://api.devnet.solana.com
solana airdrop 2
anchor deploy --provider.cluster devnet

# 5. Run Integration QA Verification Suite
anchor test --skip-local-validator