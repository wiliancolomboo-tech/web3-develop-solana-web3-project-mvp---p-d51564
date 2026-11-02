curl -s http://localhost:8080/healthz | jq
  # Response:
  # {
  #   "status": "healthy",
  #   "uptime": 142.12,
  #   "network": "https://api.devnet.solana.com",
  #   "timestamp": 1729000000000
  # }