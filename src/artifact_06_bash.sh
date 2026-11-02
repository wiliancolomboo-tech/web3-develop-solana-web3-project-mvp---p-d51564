#!/usr/bin/env bash
set -euo pipefail

echo ">>> Initializing KUBG UNI Vibeathon Deployment Sequence..."

# 1. Check Solana CLI and Anchor
solana config set --url https://api.devnet.solana.com
echo ">>> Deployer Account: $(solana address)"

# 2. Build program artifacts
anchor build

# 3. Synchronize Keys
PROGRAM_ID=$(solana address -k target/deploy/univibe_core-keypair.json)
echo ">>> Detected Program ID: $PROGRAM_ID"

# 4. Deploy Program to Solana Devnet
solana program deploy \
    --program-id target/deploy/univibe_core-keypair.json \
    target/deploy/univibe_core.so

echo ">>> Program deployed successfully to Devnet: $PROGRAM_ID"