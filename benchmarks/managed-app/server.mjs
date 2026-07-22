import { createServer } from "node:http";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const portIndex = process.argv.indexOf("--port");
const port = Number(portIndex >= 0 ? process.argv[portIndex + 1] : 41237);
const stateFile = path.resolve(".realdone", "managed-state.json");
const readState = async () => readFile(stateFile, "utf8").then((value) => JSON.parse(value), () => ({ value: "" }));

const server = createServer(async (request, response) => {
  if (request.url === "/health") {
    response.writeHead(200, { "content-type": "application/json" });
    return response.end(JSON.stringify({ status: "ok" }));
  }
  if (request.method === "POST" && request.url === "/api/state") {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const value = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    await mkdir(path.dirname(stateFile), { recursive: true });
    await writeFile(stateFile, JSON.stringify(value));
    response.writeHead(201, { "content-type": "application/json", location: "/api/state" });
    return response.end(JSON.stringify({ id: "state", ...value }));
  }
  if (request.method === "GET" && request.url === "/api/state") {
    response.writeHead(200, { "content-type": "application/json" });
    return response.end(JSON.stringify(await readState()));
  }
  const state = await readState();
  response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  response.end(`<!doctype html><html><head><meta charset="utf-8"><title>Managed fixture</title></head><body><h1>Managed runtime</h1><form id="runtime-form"><label>Runtime value <input name="value" required></label><button type="submit">Save runtime state</button></form><p id="runtime-state">${String(state.value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;")}</p><button id="panel">Open panel</button><p id="status">Closed</p><script>document.getElementById('runtime-form').onsubmit=async event=>{event.preventDefault();const form=document.getElementById('runtime-form');const value=form.elements.value.value;await fetch('/api/state',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({value})});document.getElementById('runtime-state').textContent=value};document.getElementById('panel').onclick=()=>{document.getElementById('status').textContent='Panel opened'}</script></body></html>`);
});

server.listen(port, "127.0.0.1", () => process.stdout.write(`READY http://127.0.0.1:${port}\n`));
const close = () => server.close(() => process.exit(0));
process.on("SIGINT", close);
process.on("SIGTERM", close);
