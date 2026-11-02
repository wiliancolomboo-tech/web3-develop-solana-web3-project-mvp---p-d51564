# 1. Clone repository & install dependencies
git clone https://github.com/campusvibe/campusvibe-core.git
cd campusvibe-core
npm install

# 2. Build the Anchor smart contract
anchor build

# 3. Synchronize Program ID
# Copy output Program ID to Anchor.toml and src/lib.rs
solana address -k target/deploy/vibe_vault-keypair.json

# 4. Deploy to Solana Devnet
solana config set --url https://api.devnet.solana.com
anchor deploy --provider.cluster devnet

# 5. Run the full verification test suite against local-validator / devnet
anchor test