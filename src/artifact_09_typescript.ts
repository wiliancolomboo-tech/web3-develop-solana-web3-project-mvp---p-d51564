import http from "http";

const PORT = process.env.PORT || 8080;
const server = http.createServer((req, res) => {
  if (req.url === "/healthz") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "healthy", timestamp: Date.now(), service: "UniVibe Daemon" }));
  } else {
    res.writeHead(404);
    res.end();
  }
});
server.listen(PORT, () => console.log(`[HEALTH] Healthcheck server live on :${PORT}`));