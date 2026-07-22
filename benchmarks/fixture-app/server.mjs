import { createServer } from "node:http";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";

const state = {
  customers: [],
  invoices: [],
  profiles: { partial: {}, wrong: { displayName: "Other user", role: "viewer" } },
  selectorShiftLoads: 0,
  breakCreate: false,
};

function html(title, body, script = "") {
  const expandedBody = title === "RealDone benchmark fixtures"
    ? body.replace("</nav>", '<a href="/phase-d">Phase D detector lab</a><a href="/recorder-complex">Complex recorder lab</a></nav>')
    : body;
  return `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title><style>body{font:16px system-ui;max-width:720px;margin:48px auto;padding:0 24px}nav{display:flex;gap:12px;flex-wrap:wrap;margin:24px 0}form{display:grid;gap:10px;max-width:420px}input,button{font:inherit;padding:10px}li{margin:8px 0}.toast{margin-top:16px;padding:10px;background:#dcfce7}.error{background:#fee2e2}</style></head><body><a href="/">← Fixtures</a><h1>${title}</h1>${expandedBody}<div id="notice" role="status"></div><script>${script}</script></body></html>`;
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
  const server = createServer(async (request, response) => {
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
    if (request.method === "GET" && url.pathname === "/api/live-data") return json(response, 200, { customers: ["Live Alice", "Live Bob"] });
    if (request.method === "POST" && url.pathname === "/api/upload") {
      let size = 0;
      for await (const chunk of request) size += chunk.length;
      return json(response, 201, { id: `upload-${size}`, size });
    }
    if (request.method === "POST" && url.pathname === "/api/login") {
      await body(request);
      return json(response, 200, { id: "session-fixture", authenticated: true });
    }
    if (request.method === "POST" && url.pathname === "/api/payments") {
      await body(request);
      return json(response, 201, { id: `payment-${Date.now()}`, accepted: true });
    }
    if (request.method === "POST" && url.pathname === "/api/webhook") {
      await body(request);
      return json(response, 202, { id: `webhook-${Date.now()}`, accepted: true });
    }
    if (url.pathname.startsWith("/api/authz/allowed/")) {
      await body(request);
      return json(response, 200, { allowed: true, tenant: "other-tenant" });
    }
    if (url.pathname.startsWith("/api/authz/denied/")) {
      await body(request);
      return json(response, 403, { allowed: false });
    }
    if (url.pathname === "/download-empty.csv") {
      response.writeHead(200, { "content-type": "text/csv", "content-disposition": "attachment; filename=empty.csv" });
      return response.end("");
    }
    if (url.pathname === "/static-export.csv") {
      response.writeHead(200, { "content-type": "text/csv", "content-disposition": "attachment; filename=static.csv" });
      return response.end("id,name\n1,Alice\n");
    }
    if (url.pathname === "/generated-export.csv" || url.pathname === "/incomplete-export.csv") {
      const first = url.searchParams.get("first") ?? "";
      const second = url.searchParams.get("second") ?? "";
      response.writeHead(200, { "content-type": "text/csv", "content-disposition": `attachment; filename=${url.pathname.includes("incomplete") ? "incomplete" : "generated"}.csv` });
      return response.end(url.pathname.includes("incomplete") ? `first\n${first}\n` : `first,second\n${first},${second}\n`);
    }
    if (request.method === "PATCH" && url.pathname === "/api/settings") {
      return json(response, 500, { error: "intentional fixture failure" });
    }
    if (request.method === "PATCH" && url.pathname === "/api/profiles/partial") {
      const value = await body(request);
      state.profiles.partial = { displayName: String(value.displayName ?? "") };
      return json(response, 200, state.profiles.partial);
    }
    if (request.method === "PATCH" && url.pathname === "/api/profiles/wrong") {
      await body(request);
      return json(response, 200, { accepted: true });
    }
    if (request.method === "GET" && url.pathname === "/api/profiles/partial") return json(response, 200, state.profiles.partial);
    if (request.method === "GET" && url.pathname === "/api/profiles/wrong") return json(response, 200, state.profiles.wrong);
    if (request.method === "GET" && url.pathname === "/api/customers") return json(response, 200, state.customers);
    if (request.method === "GET" && /^\/api\/customers\/\d+$/.test(url.pathname)) {
      const index = Number(url.pathname.split("/").at(-1)) - 1;
      const name = state.customers[index];
      return name === undefined ? json(response, 404, { error: "not found" }) : json(response, 200, { id: index + 1, name });
    }
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
      return response.end(html("RealDone benchmark fixtures", `<p>Each page contains one known behavior.</p><nav><a href="/fake-create">Fake create</a><a href="/fake-update">Fake update</a><a href="/partial-update">Partial update</a><a href="/wrong-update">Wrong update</a><a href="/false-success-redirect">False success redirect</a><a href="/real-create">Real create control</a><a href="/enter-submit">Enter-submit create</a><a href="/keyboard-no-effect">Keyboard no-effect</a><a href="/browser-local">Browser-local control</a><a href="/session-control">Session control</a><a href="/snapshot-control">Snapshot control</a><a href="/success-despite-failure">False success</a><a href="/duplicate-submit">Duplicate submit</a><a href="/fake-delete">Fake delete</a><a href="/no-effect">No effect</a><a href="/stuck-loading">Stuck loading</a><a href="/loading-control">Loading control</a><a href="/native-controls">Native controls</a><a href="/popup-control">Popup control</a><a href="/download-control">Download control</a><a href="/websocket-control">WebSocket control</a><a href="/context-control">Context control</a><a href="/iframe-control">Iframe control</a><a href="/dynamic-actions">Dynamic actions</a><a href="/complex-recording">Complex recording boundary</a><a href="/unrelated-fields">Unrelated fields control</a><a href="/selector-shift">Selector survival control</a><a href="/stateful-action">Stateful action control</a><a href="/live-control-state">Live control-state control</a><a href="/missing">Broken navigation</a></nav>`));
    }
    if (url.pathname === "/phase-d") {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      return response.end(html("Phase D detector lab", `
        <section><button id="demo">Load demo data</button><button id="demo-control">Load demo data from server</button><div id="demo-output"></div></section>
        <section><button id="fixture">Load frontend fixture data</button><div id="fixture-output"></div></section>
        <form id="static-search"><label>Search query <input name="query" type="search" required></label><button type="submit">Search static customers</button></form><div id="static-results"></div>
        <form id="live-search"><label>Live search query <input name="query" type="search" required></label><button type="submit">Search live customers</button></form><div id="live-results"></div>
        <section><button id="dashboard">Refresh dashboard</button><button id="dashboard-control">Refresh dashboard from server</button><div id="dashboard-output">Dashboard total: 2</div></section>
        <nav><a href="/customers/42">Placeholder customer details</a><a href="/customers/43">Real customer details</a><a href="/private">Direct private account</a><a href="/private/denied">Denied private account</a><a href="/payment/success">Payment success page</a><a href="/logout-lab">Logout controls</a></nav>
        <form id="fake-login"><label>Email <input name="email" type="email" required></label><label>Password <input name="password" type="password" required></label><button type="submit">Fake login</button></form>
        <form id="login-control"><label>Control email <input name="email" type="email" required></label><label>Control password <input name="password" type="password" required></label><button type="submit">Persistent login</button></form>
        <section><button id="expired">Open account with expired session</button><div id="expired-output"></div></section>
        <form id="fake-upload"><label>Fake receipt <input name="receipt" type="file" required></label><button type="submit">Upload fake receipt</button></form><div id="fake-upload-output"></div>
        <form id="blob-upload"><label>Blob receipt <input name="receipt" type="file" required></label><button type="submit">Upload blob receipt</button></form><div id="blob-upload-output"></div>
        <form id="real-upload"><label>Real receipt <input name="receipt" type="file" required></label><button type="submit">Upload persisted receipt</button></form><div id="real-upload-output"></div>
        <a href="/download-empty.csv" download="empty.csv">Download broken report</a>
        <form id="static-export"><label>First export value <input name="first" required></label><label>Second export value <input name="second" required></label><button type="submit">Export static customers</button></form>
        <form id="incomplete-export"><label>First incomplete value <input name="first" required></label><label>Second incomplete value <input name="second" required></label><button type="submit">Export incomplete customers</button></form>
        <form id="complete-export"><label>First complete value <input name="first" required></label><label>Second complete value <input name="second" required></label><button type="submit">Export complete customers</button></form>
        <section><button id="fake-payment">Pay without provider</button><button id="duplicate-payment">Pay invoice twice</button><button id="provider-missing">Pay order once</button><div id="payment-output"></div></section>
        <form id="webhook-missing"><label>Webhook event <input name="event" required></label><button type="submit">Process webhook silently</button></form>
        <form id="webhook-control"><label>Confirmed webhook event <input name="event" required></label><button type="submit">Process webhook visibly</button></form><div id="webhook-output"></div>
      `, `
        const show=(id,value)=>document.getElementById(id).textContent=value;
        demo.onclick=()=>show('demo-output','Alice, Bob');
        document.getElementById('demo-control').onclick=async()=>show('demo-output',JSON.stringify(await fetch('/api/live-data').then(r=>r.json())));
        fixture.onclick=()=>show('fixture-output','Fixture customer 1');
        document.getElementById('static-search').onsubmit=e=>{e.preventDefault();show('static-results','Alice, Bob')};
        document.getElementById('live-search').onsubmit=async e=>{e.preventDefault();const q=e.target.query.value;await fetch('/api/live-data?q='+encodeURIComponent(q));show('live-results','Search result for '+q)};
        dashboard.onclick=()=>show('dashboard-output','Dashboard total: 2');
        document.getElementById('dashboard-control').onclick=async()=>{await fetch('/api/live-data');show('dashboard-output','Dashboard refreshed from server')};
        document.getElementById('fake-login').onsubmit=e=>{e.preventDefault();history.pushState({},'', '/welcome');show('notice','Private account dashboard')};
        document.getElementById('login-control').onsubmit=async e=>{e.preventDefault();await fetch('/api/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email:e.target.email.value})});localStorage.setItem('rd_session','active');show('notice','Private account dashboard')};
        if(localStorage.getItem('rd_session'))show('notice','Private account dashboard');
        document.getElementById('expired').onclick=()=>{localStorage.setItem('rd_auth_token','eyJhbGciOiJub25lIn0.eyJleHAiOjF9.');show('expired-output','Private account dashboard')};
        document.getElementById('fake-upload').onsubmit=e=>{e.preventDefault();show('fake-upload-output','Upload successful: '+e.target.receipt.files[0].name)};
        document.getElementById('blob-upload').onsubmit=e=>{e.preventDefault();const image=document.createElement('img');image.alt='temporary receipt';image.src=URL.createObjectURL(e.target.receipt.files[0]);document.getElementById('blob-upload-output').replaceChildren(image)};
        document.getElementById('real-upload').onsubmit=async e=>{e.preventDefault();const file=e.target.receipt.files[0];await fetch('/api/upload',{method:'POST',body:file});show('real-upload-output','Stored '+file.name)};
        const download=(target,name)=>{const link=document.createElement('a');link.href=target;link.download=name;document.body.append(link);link.click();link.remove()};
        document.getElementById('static-export').onsubmit=e=>{e.preventDefault();download('/static-export.csv','static.csv')};
        document.getElementById('incomplete-export').onsubmit=e=>{e.preventDefault();download('/incomplete-export.csv?first='+encodeURIComponent(e.target.first.value)+'&second='+encodeURIComponent(e.target.second.value),'incomplete.csv')};
        document.getElementById('complete-export').onsubmit=e=>{e.preventDefault();download('/generated-export.csv?first='+encodeURIComponent(e.target.first.value)+'&second='+encodeURIComponent(e.target.second.value),'generated.csv')};
        document.getElementById('fake-payment').onclick=()=>show('payment-output','Payment successful');
        document.getElementById('duplicate-payment').onclick=async()=>{await Promise.all([fetch('/api/payments',{method:'POST'}),fetch('/api/payments',{method:'POST'})]);show('payment-output','Payment successful')};
        document.getElementById('provider-missing').onclick=async()=>{await fetch('/api/payments',{method:'POST'});show('payment-output','Payment successful')};
        document.getElementById('webhook-missing').onsubmit=async e=>{e.preventDefault();await fetch('/api/webhook',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({event:e.target.event.value})})};
        document.getElementById('webhook-control').onsubmit=async e=>{e.preventDefault();await fetch('/api/webhook',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({event:e.target.event.value})});show('webhook-output','Webhook confirmed '+e.target.event.value)};
      `));
    }
    if (url.pathname === "/recorder-complex") {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      return response.end(html("Complex recorder lab", `
        <label>Receipt file <input id="complex-upload" name="receipt" type="file"></label>
        <div id="rich-editor" contenteditable="true" aria-label="Rich description">Initial description</div>
        <label>Command <input id="command" name="command" aria-label="Command"></label>
        <button id="open-popup">Open receipt popup</button>
        <a id="complex-download" href="/download-file" download="complex-report.csv">Download complex report</a>
        <div id="drag-source" draggable="true" aria-label="Source card">Source card</div>
        <div id="drag-target" aria-label="Target lane">Target lane</div>
      `, `
        document.getElementById('command').addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();notice.textContent='Command submitted'}});
        document.getElementById('open-popup').onclick=()=>window.open('/popup-result','receipt-popup');
        document.getElementById('drag-target').addEventListener('dragover',event=>event.preventDefault());
        document.getElementById('drag-target').addEventListener('drop',event=>{event.preventDefault();notice.textContent='Card moved'});
      `));
    }
    if (url.pathname === "/popup-result") {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      return response.end(html("Popup result", "<p>Receipt popup ready</p>"));
    }
    if (url.pathname === "/customers/42") {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      return response.end(html("Customer detail", "<p>Customer detail coming soon</p>"));
    }
    if (url.pathname === "/customers/43") {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      return response.end(html("Customer detail", "<p>Customer 43: Live Alice</p>"));
    }
    if (url.pathname === "/private") {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      return response.end(html("Private account", "<p>Private account billing records</p>"));
    }
    if (url.pathname === "/private/denied") {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      return response.end(html("Access denied", "<p>Forbidden: access denied</p>"));
    }
    if (url.pathname === "/logout-lab") {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      return response.end(html("Logout controls", `<section id="logout-zone"><p>Private account settings</p><button id="bad-logout">Logout without revoke</button><button id="good-logout">Logout and revoke</button></section>`, `if(localStorage.getItem('rd_logout_revoked')){document.getElementById('logout-zone').textContent='Signed out; access denied'}else{sessionStorage.setItem('rd_logout_session','active')}document.getElementById('bad-logout')?.addEventListener('click',()=>{notice.textContent='Private account settings remain active'});document.getElementById('good-logout')?.addEventListener('click',()=>{sessionStorage.removeItem('rd_logout_session');localStorage.setItem('rd_logout_revoked','yes');document.getElementById('logout-zone').textContent='Signed out; access denied'})`));
    }
    if (url.pathname === "/payment/success") {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      return response.end(html("Payment success", "<p>Payment successful. Order complete.</p>"));
    }
    if (url.pathname === "/admin-exposed") {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      return response.end(html("Admin console", "<p>Administration console and tenant controls</p>"));
    }
    if (url.pathname === "/admin-denied") {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      return response.end(html("Access denied", "<p>Forbidden: access denied</p>"));
    }
    if (url.pathname === "/welcome") {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      return response.end(html("Welcome", "<p>Public welcome page</p>"));
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
    if (url.pathname === "/session-control") {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      return response.end(html("Session persistence", `<form id="session-form"><label>Session value <input name="value" required></label><button type="submit">Save for this session</button></form><p id="session-state"></p>`, `const key='realdone-session';const form=document.getElementById('session-form');const show=()=>document.getElementById('session-state').textContent=sessionStorage.getItem(key)||'';show();form.addEventListener('submit',e=>{e.preventDefault();sessionStorage.setItem(key,form.elements.value.value);show()})`));
    }
    if (url.pathname === "/snapshot-control") {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      return response.end(html("Snapshot control", `<form id="snapshot"><label>Snapshot value <input name="value" required></label><button type="submit">Save snapshot locally</button></form><p id="snapshot-state"></p>`, `const key='realdone-snapshot';const form=document.getElementById('snapshot');const show=()=>{document.getElementById('snapshot-state').textContent=localStorage.getItem(key)||''};show();form.addEventListener('submit',e=>{e.preventDefault();const value=form.elements.value.value;localStorage.setItem(key,value);document.cookie='rd_snapshot='+encodeURIComponent(value)+'; path=/';const open=indexedDB.open('realdone-fixture',1);open.onupgradeneeded=()=>open.result.createObjectStore('snapshots',{autoIncrement:true});open.onsuccess=()=>{const tx=open.result.transaction('snapshots','readwrite');tx.objectStore('snapshots').add({value});tx.oncomplete=()=>{open.result.close();show()}}})`));
    }
    if (url.pathname === "/enter-submit") {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      return response.end(html("Enter-submit create", `<input class="new-todo" type="text" aria-label="New Todo Input" placeholder="What needs to be done?"><ul id="list"></ul>`, `document.querySelector('.new-todo').addEventListener('keydown',e=>{if(e.key==='Enter'&&e.target.value.trim()){list.insertAdjacentHTML('beforeend','<li>'+e.target.value.trim()+'</li>');e.target.value=''}})`));
    }
    if (url.pathname === "/keyboard-no-effect") {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      return response.end(html("Keyboard action missed", `<input type="text" name="new-message" aria-label="New message" placeholder="Send a message">`));
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
    if (url.pathname === "/partial-update") {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      return response.end(html("Partial update", `<form id="partial"><label>Display name <input name="displayName" required></label><label>Role name <input name="role" required></label><button type="submit">Save partial profile</button></form><p id="profile-state"></p>`, `document.getElementById('partial').addEventListener('submit',async e=>{e.preventDefault();const form=document.getElementById('partial');const value={displayName:form.displayName.value,role:form.role.value};await fetch('/api/profiles/partial',{method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify(value)});document.getElementById('profile-state').textContent=value.displayName+' '+value.role})`));
    }
    if (url.pathname === "/wrong-update") {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      return response.end(html("Wrong resource update", `<form id="wrong"><label>Display name <input name="displayName" required></label><label>Role name <input name="role" required></label><button type="submit">Save wrong profile</button></form><p id="wrong-state"></p>`, `document.getElementById('wrong').addEventListener('submit',async e=>{e.preventDefault();const form=document.getElementById('wrong');const value={displayName:form.displayName.value,role:form.role.value};await fetch('/api/profiles/wrong',{method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify(value)});document.getElementById('wrong-state').textContent=value.displayName+' '+value.role})`));
    }
    if (url.pathname === "/false-success-redirect") {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      return response.end(html("False success redirect", `<form id="redirect"><label>Order name <input name="name" required></label><button type="submit">Complete order</button></form>`, `document.getElementById('redirect').addEventListener('submit',e=>{e.preventDefault();location.href='/success-complete'})`));
    }
    if (url.pathname === "/success-complete") {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      return response.end(html("Success complete", `<p>Order completed successfully.</p>`));
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
    if (url.pathname === "/stuck-loading") {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      return response.end(html("Stuck loading", `<button id="stuck">Load forever</button>`, `document.getElementById('stuck').onclick=()=>{document.getElementById('stuck').setAttribute('aria-busy','true');document.getElementById('stuck').textContent='Loading forever'}`));
    }
    if (url.pathname === "/loading-control") {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      return response.end(html("Loading control", `<button id="load">Load dashboard</button><p id="result">Idle</p>`, `document.getElementById('load').onclick=()=>{document.getElementById('load').setAttribute('aria-busy','true');setTimeout(()=>{document.getElementById('load').setAttribute('aria-busy','false');document.getElementById('result').textContent='Dashboard loaded'},100)}`));
    }
    if (url.pathname === "/native-controls") {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      return response.end(html("Native controls", `<label>Enable alerts <input id="alerts" type="checkbox"></label><label>Theme <select id="theme"><option value="">Choose</option><option value="dark">Dark</option></select></label><p id="control-state">Unchanged</p>`, `document.getElementById('alerts').onchange=()=>{document.getElementById('control-state').textContent='Alerts enabled'};document.getElementById('theme').onchange=()=>{document.getElementById('control-state').textContent='Theme '+document.getElementById('theme').value}`));
    }
    if (url.pathname === "/popup-control") {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      return response.end(html("Popup control", `<button id="popup">Open popup</button>`, `document.getElementById('popup').onclick=()=>window.open('/popup-result','realdone-popup')`));
    }
    if (url.pathname === "/popup-result") {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      return response.end(html("Popup result", `<p>Popup opened successfully.</p>`));
    }
    if (url.pathname === "/download-control") {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      return response.end(html("Download control", `<a id="download" href="/download-file" download="realdone-export.csv">Download report</a>`));
    }
    if (url.pathname === "/download-file") {
      response.writeHead(200, { "content-type": "text/csv", "content-disposition": "attachment; filename=realdone-export.csv" });
      return response.end(`id,name\n1,RD_EXPORT_CONTROL\n`);
    }
    if (url.pathname === "/websocket-control") {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      return response.end(html("WebSocket control", `<button id="socket">Open live channel</button><p id="socket-state">Closed</p>`, `document.getElementById('socket').onclick=()=>{const protocol=location.protocol==='https:'?'wss:':'ws:';const channel=new WebSocket(protocol+'//'+location.host+'/fixture-socket');channel.onmessage=event=>{document.getElementById('socket-state').textContent=event.data};channel.onopen=()=>channel.send('client-ready')}`));
    }
    if (url.pathname === "/context-control") {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      return response.end(html("Context control", `<div id="row-menu" aria-label="Open row menu" oncontextmenu="event.preventDefault();document.getElementById('context-state').textContent='Row menu opened'">Right-click this row</div><p id="context-state">Closed</p>`));
    }
    if (url.pathname === "/iframe-control") {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      return response.end(html("Iframe control", `<iframe title="Embedded settings" src="/iframe-content" style="width:100%;height:220px"></iframe>`));
    }
    if (url.pathname === "/iframe-content") {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      return response.end(`<!doctype html><html><head><meta charset="utf-8"><title>Embedded settings</title></head><body><button id="iframe-action">Enable embedded setting</button><p id="iframe-state">Disabled</p><script>document.getElementById('iframe-action').onclick=()=>{document.getElementById('iframe-state').textContent='Embedded setting enabled'}</script></body></html>`);
    }
    if (url.pathname === "/dynamic-actions") {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      return response.end(html("Dynamic actions", `<div id="hover-zone" onmouseenter="if(!document.getElementById('revealed'))this.insertAdjacentHTML('beforeend','<button id=&quot;revealed&quot;>Reveal details</button>')">Hover actions</div><p id="dynamic-state">Closed</p><div style="height:1200px"></div><div id="lazy"></div>`, `addEventListener('scroll',()=>{if(!document.getElementById('lazy-action'))lazy.innerHTML='<button id="lazy-action">Load more rows</button>';const revealed=document.getElementById('revealed');if(revealed)revealed.onclick=()=>{document.getElementById('dynamic-state').textContent='Details revealed'};setTimeout(()=>{const action=document.getElementById('lazy-action');if(action)action.onclick=()=>{document.getElementById('dynamic-state').textContent='More rows loaded'}},0)})`));
    }
    if (url.pathname === "/complex-recording") {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      return response.end(html("Complex recording boundary", `<label>Upload receipt <input type="file" id="receipt"></label><canvas aria-label="Signature canvas" width="240" height="80">Signature canvas</canvas><div contenteditable="true" aria-label="Rich description">Rich description</div><div draggable="true" aria-label="Draggable card">Draggable card</div><button id="simple-control">Open simple control</button><p id="simple-state">Closed</p>`, `document.getElementById('simple-control').onclick=()=>{document.getElementById('simple-state').textContent='Opened'}`));
    }
    if (url.pathname === "/unrelated-fields") {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      return response.end(html("Unrelated fields", `<div><form><label>Customer name <input name="customer"></label><button>Create customer preview</button></form><form><label>Display name <input name="display"></label><button>Save profile preview</button></form><button id="unrelated">Do nothing nearby</button></div>`));
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
    if (url.pathname === "/environment-control") {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      return response.end(`<!doctype html><html><head><meta charset="utf-8"><title>Healthy environment</title><link rel="stylesheet" href="/environment.css"></head><body><main><h1>Healthy application</h1><button id="ready">Ready control</button></main><script src="/environment.js"></script></body></html>`);
    }
    if (url.pathname === "/environment.js") {
      response.writeHead(200, { "content-type": "application/javascript; charset=utf-8" });
      return response.end(`document.documentElement.dataset.bootstrapped='true';`);
    }
    if (url.pathname === "/environment.css") {
      response.writeHead(200, { "content-type": "text/css; charset=utf-8" });
      return response.end(`body{font:16px system-ui}`);
    }
    if (url.pathname === "/environment-invalid") {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      return response.end(`<!doctype html><html><head><meta charset="utf-8"><title>Broken environment</title></head><body><div id="root"></div><script src="/missing-bundle.js"></script></body></html>`);
    }
    if (url.pathname === "/delayed-bootstrap") {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      return response.end(`<!doctype html><html><head><meta charset="utf-8"><title>Delayed bootstrap</title></head><body><main id="root"><p>Application shell is loading.</p><p>The browser document is valid but interactive controls are not mounted yet.</p><p>Discovery must wait for runtime readiness.</p></main><p id="status">Closed</p><script>setTimeout(()=>{document.getElementById('root').insertAdjacentHTML('beforeend','<button id="delayed">Open delayed panel</button>');document.getElementById('delayed').onclick=()=>{document.getElementById('status').textContent='Delayed panel opened'}},800)</script></body></html>`);
    }
    if (url.pathname === "/missing-bundle.js") {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      return response.end(`<!doctype html><title>SPA fallback instead of JavaScript</title>`);
    }
    response.writeHead(404, { "content-type": "text/html; charset=utf-8" });
    return response.end(html("404", "<p>This route is intentionally missing.</p>"));
  });
  server.on("upgrade", (request, socket) => {
    if (request.url !== "/fixture-socket" || !request.headers["sec-websocket-key"]) return socket.destroy();
    const accept = createHash("sha1")
      .update(`${request.headers["sec-websocket-key"]}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
      .digest("base64");
    socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
    const payload = Buffer.from("Live channel opened");
    socket.write(Buffer.concat([Buffer.from([0x81, payload.length]), payload]));
  });
  return server;
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
