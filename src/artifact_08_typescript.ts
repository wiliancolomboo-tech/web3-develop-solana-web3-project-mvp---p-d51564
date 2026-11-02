import http from "http";

const server = http.createServer((req, res) => {
  if (req.url === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "healthy", slot: connection.getSlot() }));
  } else {
    res.writeHead(404);
    res.end();
  }
});
server.listen(8080, () => console.log("Healthcheck endpoint listening on :8080/health"));