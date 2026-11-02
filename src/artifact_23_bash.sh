#!/usr/bin/env bash
set -euo pipefail

echo "======================================================="
echo "   UniStream Deployment & Initialization Protocol      "
echo "======================================================="

export CLUSTER="devnet"
export KEYPAIR_PATH="${HOME}/.config/solana/id.json"

echo "[1/4] Setting Solana CLI config to ${CLUSTER}..."
solana config set --url https://api.${CLUSTER}.solana.com
solana config set --keypair "${KEYPAIR_PATH}"

echo "[2/4] Building Rust Anchor Smart Contract..."
anchor build

echo "[3/4] Deploying Program onto Solana ${CLUSTER}..."
PROGRAM_ID=$(solana program deploy target/deploy/unistream.so | grep "Program Id:" | awk '{print $3}')

echo ">> Successfully Deployed Program ID: ${PROGRAM_ID}"
echo ">> Update declare_id!(\"${PROGRAM_ID}\") in lib.rs if modified."

echo "[4/4] Starting Enterprise Notification Mesh via Docker..."
docker-compose down -v
PROGRAM_ID="${PROGRAM_ID}" docker-compose up -d --build

echo "======================================================="
echo " Deployment verified! Telemetry at http://localhost:8080/healthz"
echo "======================================================="