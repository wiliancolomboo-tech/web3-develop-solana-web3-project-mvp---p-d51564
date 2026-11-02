import http from "http";

const server = http.createServer((req, res) => {
  if (req.url === "/healthz") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      status: "UP",
      timestamp: Date.now(),
      service: "solvibe-relayer-crank",
      solana_connection: "HEALTHY"
    }));
  } else {
    res.writeHead(404);
    res.end();
  }
});
server.listen(process.env.PORT || 8080);