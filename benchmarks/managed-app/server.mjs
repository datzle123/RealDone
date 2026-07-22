import { createServer } from "node:http";

const portIndex = process.argv.indexOf("--port");
const port = Number(portIndex >= 0 ? process.argv[portIndex + 1] : 41237);
const server = createServer((request, response) => {
  if (request.url === "/health") {
    response.writeHead(200, { "content-type": "application/json" });
    return response.end(JSON.stringify({ status: "ok" }));
  }
  response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  response.end(`<!doctype html><html><head><meta charset="utf-8"><title>Managed fixture</title></head><body><h1>Managed runtime</h1><button id="panel">Open panel</button><p id="status">Closed</p><script>document.getElementById('panel').onclick=()=>{document.getElementById('status').textContent='Panel opened'}</script></body></html>`);
});

server.listen(port, "127.0.0.1", () => process.stdout.write(`READY http://127.0.0.1:${port}\n`));
const close = () => server.close(() => process.exit(0));
process.on("SIGINT", close);
process.on("SIGTERM", close);
