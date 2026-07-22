import { createServer } from "node:http";
import { pathToFileURL } from "node:url";

const state = {
  customers: [],
  invoices: [],
};

function html(title, body, script = "") {
  return `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title><style>body{font:16px system-ui;max-width:720px;margin:48px auto;padding:0 24px}nav{display:flex;gap:12px;flex-wrap:wrap;margin:24px 0}form{display:grid;gap:10px;max-width:420px}input,button{font:inherit;padding:10px}li{margin:8px 0}.toast{margin-top:16px;padding:10px;background:#dcfce7}.error{background:#fee2e2}</style></head><body><a href="/">← Fixtures</a><h1>${title}</h1>${body}<div id="notice" role="status"></div><script>${script}</script></body></html>`;
}

function json(response, status, value) {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(value));
}

async function body(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { return {}; }
}

export function createFixtureServer() {
  return createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", "http://fixture.local");
    if (request.method === "POST" && url.pathname === "/api/customers") {
      const value = await body(request);
      state.customers.push(String(value.name ?? ""));
      return json(response, 201, { id: state.customers.length, ...value });
    }
    if (request.method === "POST" && url.pathname === "/api/invoices") {
      const value = await body(request);
      state.invoices.push(String(value.name ?? ""));
      return json(response, 201, { id: state.invoices.length, ...value });
    }
    if (request.method === "PATCH" && url.pathname === "/api/settings") {
      return json(response, 500, { error: "intentional fixture failure" });
    }
    if (request.method === "GET" && url.pathname === "/api/customers") return json(response, 200, state.customers);

    if (url.pathname === "/") {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      return response.end(html("RealDone benchmark fixtures", `<p>Each page contains one known behavior.</p><nav><a href="/fake-create">Fake create</a><a href="/real-create">Real create control</a><a href="/success-despite-failure">False success</a><a href="/duplicate-submit">Duplicate submit</a><a href="/fake-delete">Fake delete</a><a href="/no-effect">No effect</a><a href="/missing">Broken navigation</a></nav>`));
    }
    if (url.pathname === "/fake-create") {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      return response.end(html("Fake create", `<form id="create"><label>Customer name <input name="name" required></label><button type="submit">Create customer</button></form><ul id="list"></ul>`, `create.addEventListener('submit',e=>{e.preventDefault();list.insertAdjacentHTML('beforeend','<li>'+create.name.value+'</li>');notice.className='toast';notice.textContent='Customer created successfully';})`));
    }
    if (url.pathname === "/real-create") {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      return response.end(html("Real create control", `<form id="create"><label>Customer name <input name="name" required></label><button type="submit">Create customer</button></form><ul id="list"></ul>`, `async function load(){const values=await fetch('/api/customers').then(r=>r.json());list.innerHTML=values.map(v=>'<li>'+v+'</li>').join('')}load();create.addEventListener('submit',async e=>{e.preventDefault();const name=create.name.value;await fetch('/api/customers',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({name})});await load();notice.className='toast';notice.textContent='Customer created successfully'})`));
    }
    if (url.pathname === "/success-despite-failure") {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      return response.end(html("False success", `<form id="settings"><label>Display name <input name="displayName" required></label><button type="submit">Save settings</button></form>`, `settings.addEventListener('submit',async e=>{e.preventDefault();notice.className='toast';notice.textContent='Saved successfully';await fetch('/api/settings',{method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify({displayName:settings.displayName.value})})})`));
    }
    if (url.pathname === "/duplicate-submit") {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      return response.end(html("Duplicate submit", `<form id="invoice"><label>Invoice name <input name="name" required></label><button type="submit">Create invoice</button></form><ul id="list"></ul>`, `invoice.addEventListener('submit',async e=>{e.preventDefault();const payload={name:invoice.name.value};await Promise.all([fetch('/api/invoices',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(payload)}),fetch('/api/invoices',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(payload)})]);list.innerHTML='<li>'+payload.name+'</li>';notice.className='toast';notice.textContent='Invoice created successfully'})`));
    }
    if (url.pathname === "/fake-delete") {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      return response.end(html("Fake delete", `<ul><li id="customer">RD_SEEDED_CUSTOMER <button id="delete">Delete customer</button></li></ul>`, `document.getElementById('delete').onclick=()=>{customer.remove();notice.className='toast';notice.textContent='Customer deleted successfully'}`));
    }
    if (url.pathname === "/no-effect") {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      return response.end(html("No effect", `<button id="nothing">Do nothing</button>`));
    }
    response.writeHead(404, { "content-type": "text/html; charset=utf-8" });
    return response.end(html("404", "<p>This route is intentionally missing.</p>"));
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env.PORT ?? 0);
  const server = createFixtureServer();
  server.listen(port, "127.0.0.1", () => {
    const address = server.address();
    if (typeof address !== "object" || !address) throw new Error("Fixture server did not bind");
    process.stdout.write(`READY http://127.0.0.1:${address.port}\n`);
  });
  const close = () => server.close(() => process.exit(0));
  process.on("SIGINT", close);
  process.on("SIGTERM", close);
}
