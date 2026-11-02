#!/usr/bin/env bash
set -euo pipefail

echo "🚀 [UniVibe] Initializing Deployment sequence on Solana Devnet..."

# 1. Check prerequisites
command -v solana >/dev/null 2>&1 || { echo "Solana CLI required. Aborting." >&2; exit 1; }
command -v anchor >/dev/null 2>&1 || { echo "Anchor CLI required. Aborting." >&2; exit 1; }

# 2. Configure network
solana config set --url https://api.devnet.solana.com

# 3. Build Anchor artifacts
echo "📦 Building program binaries..."
anchor build

# 4. Sync Program ID
PROGRAM_ID=$(solana address -k target/deploy/univibe_protocol-keypair.json)
echo "🔑 Program ID: ${PROGRAM_ID}"

# 5. Deploy Program to Devnet
echo "⚡ Deploying to Devnet..."
solana program deploy \
  --program-id target/deploy/univibe_protocol-keypair.json \
  target/deploy/univibe_protocol.so

echo "✅ UniVibe Protocol successfully deployed to Devnet: ${PROGRAM_ID}"