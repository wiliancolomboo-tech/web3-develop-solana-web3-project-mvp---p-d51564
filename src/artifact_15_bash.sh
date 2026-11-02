#!/usr/bin/env bash
set -euo pipefail

echo "=================================================="
echo " UniVibe Protocol — Production Deployment Automation "
echo " Target Network: Solana Devnet"
echo "=================================================="

# Check for Solana CLI and Anchor
command -v solana >/dev/null 2>&1 || { echo "Solana CLI required. Aborting." >&2; exit 1; }
command -v anchor >/dev/null 2>&1 || { echo "Anchor CLI required. Aborting." >&2; exit 1; }

# Configure cluster
solana config set --url https://api.devnet.solana.com

# Build program binaries
echo "[1/4] Compiling Anchor Rust Program..."
anchor build

# Sync Program ID
PROGRAM_ID=$(solana address -k target/deploy/univibe-keypair.json)
echo "[2/4] Deployed Program Address: ${PROGRAM_ID}"

# Deploy to Devnet
echo "[3/4] Deploying program byte-stream to cluster..."
solana program deploy target/deploy/univibe.so --program-id target/deploy/univibe-keypair.json

# Execute automated tests
echo "[4/4] Running Comprehensive Mocha/Anchor Test Harness..."
anchor test --skip-deploy

echo "=================================================="
echo " UniVibe Protocol successfully deployed & verified!"
echo " Program ID: ${PROGRAM_ID}"
echo "=================================================="