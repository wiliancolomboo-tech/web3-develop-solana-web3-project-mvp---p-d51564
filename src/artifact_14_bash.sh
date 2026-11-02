# Configure production secrets
cp .env.example .env
# Edit .env with your DISCORD_WEBHOOK_URL and RESEND_API_KEY

docker compose up -d --build
docker compose logs -f univibe-daemon