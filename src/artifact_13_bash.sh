solana config set --url devnet
solana airdrop 2

# Deploy program
anchor deploy --provider.cluster devnet

# Verify deployment
solana program show $(solana-keygen pubkey target/deploy/univibe_core-keypair.json)