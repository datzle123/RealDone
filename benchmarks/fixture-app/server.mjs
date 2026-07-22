import { createServer } from "node:http";
import { pathToFileURL } from "node:url";

const state = {
  customers: [],
  invoices: [],
  selectorShiftLoads: 0,
  breakCreate: false,
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
      if (state.breakCreate) return json(response, 500, { error: "intentional regression" });
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
    if (request.method === "POST" && url.pathname === "/__control__/break-create") {
      state.breakCreate = true;
      return json(response, 200, { breakCreate: true });
    }
    if (request.method === "DELETE" && /^\/api\/customers\/\d+$/.test(url.pathname)) {
      const index = Number(url.pathname.split("/").at(-1)) - 1;
      if (index >= 0 && index < state.customers.length) state.customers.splice(index, 1);
      response.writeHead(204);
      return response.end();
    }
    if (request.method === "DELETE" && /^\/api\/invoices\/\d+$/.test(url.pathname)) {
      const index = Number(url.pathname.split("/").at(-1)) - 1;
      if (index >= 0 && index < state.invoices.length) state.invoices.splice(index, 1);
      response.writeHead(204);
      return response.end();
    }

    if (url.pathname === "/") {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      return response.end(html("RealDone benchmark fixtures", `<p>Each page contains one known behavior.</p><nav><a href="/fake-create">Fake create</a><a href="/fake-update">Fake update</a><a href="/real-create">Real create control</a><a href="/enter-submit">Enter-submit create</a><a href="/browser-local">Browser-local control</a><a href="/success-despite-failure">False success</a><a href="/duplicate-submit">Duplicate submit</a><a href="/fake-delete">Fake delete</a><a href="/no-effect">No effect</a><a href="/selector-shift">Selector survival control</a><a href="/stateful-action">Stateful action control</a><a href="/live-control-state">Live control-state control</a><a href="/missing">Broken navigation</a></nav>`));
    }
    if (url.pathname === "/fake-create") {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      return response.end(html("Fake create", `<form id="create"><label>Customer name <input name="name" required></label><button type="submit">Create customer</button></form><ul id="list"></ul>`, `create.addEventListener('submit',e=>{e.preventDefault();list.insertAdjacentHTML('beforeend','<li>'+create.name.value+'</li>');notice.className='toast';notice.textContent='Customer created successfully';})`));
    }
    if (url.pathname === "/real-create") {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      return response.end(html("Real create control", `<form id="create"><label>Customer name <input name="name" required></label><button type="submit">Create customer</button></form><ul id="list"></ul>`, `async function load(){const values=await fetch('/api/customers').then(r=>r.json());list.innerHTML=values.map(v=>'<li>'+v+'</li>').join('')}load();create.addEventListener('submit',async e=>{e.preventDefault();const name=create.name.value;await fetch('/api/customers',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({name})});await load();notice.className='toast';notice.textContent='Customer created successfully'})`));
    }
    if (url.pathname === "/browser-local") {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      return response.end(html("Browser-local persistence", `<form id="draft"><label>Draft name <input name="name" required></label><button type="submit">Save draft locally</button></form><p id="current"></p>`, `const key='realdone-browser-local';function load(){current.textContent=localStorage.getItem(key)||''}load();draft.addEventListener('submit',e=>{e.preventDefault();localStorage.setItem(key,draft.name.value);load();notice.className='toast';notice.textContent='Draft saved locally'})`));
    }
    if (url.pathname === "/enter-submit") {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      return response.end(html("Enter-submit create", `<input class="new-todo" type="text" aria-label="New Todo Input" placeholder="What needs to be done?"><ul id="list"></ul>`, `document.querySelector('.new-todo').addEventListener('keydown',e=>{if(e.key==='Enter'&&e.target.value.trim()){list.insertAdjacentHTML('beforeend','<li>'+e.target.value.trim()+'</li>');e.target.value=''}})`));
    }
    if (url.pathname === "/stateful-action") {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      return response.end(html("Stateful action", `<div id="action"></div>`, `action.innerHTML=history.length>2?'<button id="stateful-back">Back</button>':'<button id="replacement">Continue</button>';document.querySelector('button').addEventListener('click',()=>{notice.textContent='clicked '+document.querySelector('button').textContent})`));
    }
    if (url.pathname === "/live-control-state") {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      return response.end(html("Live control state", `<div><label>Server URL <input id="server-url" placeholder="https://example.com"></label></div><button id="current-domain">Use current domain</button>`, `document.getElementById('current-domain').onclick=()=>{document.getElementById('server-url').value=location.origin}`));
    }
    if (url.pathname === "/fake-update") {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      return response.end(html("Fake update", `<form id="profile"><label>Display name <input name="displayName" value="Alice" required></label><button type="submit">Save profile</button></form><p id="current">Alice</p>`, `profile.addEventListener('submit',e=>{e.preventDefault();current.textContent=profile.displayName.value;notice.className='toast';notice.textContent='Profile saved successfully'})`));
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
    if (url.pathname === "/selector-shift") {
      state.selectorShiftLoads += 1;
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      const control = state.selectorShiftLoads === 1
        ? `<main><button>Toggle resilient</button></main>`
        : `<main><section><div class="new-wrapper"><button>Toggle resilient</button></div></section></main>`;
      return response.end(html("Selector survival control", control, `document.querySelector('button').onclick=()=>{notice.textContent='Panel opened';notice.className='toast'}`));
    }
    if (url.pathname === "/recorder-secret") {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      return response.end(html("Recorder secret control", `<form id="login"><label>Email <input name="email" type="email" placeholder="Email"></label><label>Password <input name="password" type="password" placeholder="Password"></label><button>Login</button></form>`, `login.addEventListener('submit',event=>{event.preventDefault();notice.className='toast';notice.textContent='Login complete'})`));
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
