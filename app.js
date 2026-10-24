/* SmartStock – inventory & sales management (no server needed: runs in the browser, accounts come from accounts.js) */
(() => {
'use strict';

const CURRENCY = 'RWF';
const $  = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const COLORS = ['#4f46e5','#12a150','#d98a00','#1f7ae0','#d93b3b','#9333ea','#0891b2','#db2777'];

let db = null, me = null, maxUsers = 20;

/* ---------- Accounts & sign-in (runs in the browser; accounts come from accounts.js) ---------- */
const CFG = window.SMARTSTOCK || { version:0, maxUsers:20, developer:'', accounts:[] };
const MAXU = CFG.maxUsers || 20;
const IDLE_MS = 8 * 3600e3, MAX_FAILS = 5, LOCK_MS = 15 * 60e3, ITER = 100000;
const mem = {};
const store = {
  get(k){ try { const v = localStorage.getItem(k); if (v !== null) return v; } catch(e){} return mem[k] ?? null; },
  set(k,v){ mem[k] = v; try { localStorage.setItem(k, v); } catch(e){ if (e && e.name === 'QuotaExceededError') throw new Error('Browser storage is full. Download a backup and erase old data.'); } },
  del(k){ delete mem[k]; try { localStorage.removeItem(k); } catch(e){} }
};
const hex = b => [...new Uint8Array(b)].map(x => x.toString(16).padStart(2,'0')).join('');
const unhex = h => new Uint8Array(h.match(/../g).map(x => parseInt(x,16)));
const newSalt = () => hex(crypto.getRandomValues(new Uint8Array(16)));
async function hashPw(pw, salt) {
  if (!window.crypto || !crypto.subtle) throw new Error('Sign-in needs a secure connection. Open this page with https:// (or on localhost).');
  const k = await crypto.subtle.importKey('raw', new TextEncoder().encode(pw), 'PBKDF2', false, ['deriveBits']);
  return hex(await crypto.subtle.deriveBits({ name:'PBKDF2', hash:'SHA-256', salt:unhex(salt), iterations:ITER }, k, 256));
}
function published() { let n = 0; return (CFG.accounts || []).filter(a => a.role === 'admin' || ++n <= MAXU); }
const pub = a => ({ id:a.username, name:a.name, username:a.username, role:a.role, active:a.active !== false, temp:!!a.temp });

function readSession() {
  try {
    const s = JSON.parse(store.get('ss_sess'));
    if (!s || Date.now() - s.t > IDLE_MS) { store.del('ss_sess'); return null; }
    s.t = Date.now(); store.set('ss_sess', JSON.stringify(s)); return s;
  } catch(e) { return null; }
}
function curUser() {
  const s = readSession(); if (!s) return null;
  return published().find(a => a.username === s.u && a.active !== false) || null;
}
function failState() { try { const f = JSON.parse(store.get('ss_fail')); if (f && Date.now() - f.t < LOCK_MS) return f; } catch(e){} return { n:0, t:0 }; }

/* Draft = the admin's working copy of the account list. It only takes effect once the new accounts.js is uploaded. */
function getDraft() { try { const d = JSON.parse(store.get('ss_draft')); if (d && d.base === CFG.version && Array.isArray(d.accounts)) return d; } catch(e){} return null; }
const draftList = () => { const d = getDraft(); return d ? d.accounts : published().map(a => Object.assign({}, a)); };
const putDraft = list => store.set('ss_draft', JSON.stringify({ base:CFG.version, accounts:list }));
function fileText(list, version) {
  return '/* SmartStock accounts. To add or change users, use the Admin Panel, download the new accounts.js and upload it here. */\nwindow.SMARTSTOCK = {\n  version: ' + version +
    ',\n  maxUsers: ' + MAXU + ',\n  developer: ' + JSON.stringify(CFG.developer) + ',\n  accounts: [\n' + list.map(a => '    ' + JSON.stringify(a)).join(',\n') + '\n  ]\n};\n';
}

async function api(action, body) {
  body = body || {};
  const cur = curUser();
  const need = () => { if (!cur) { showAuth('Your session has ended. Please sign in again.'); throw new Error('auth'); } };
  const needAdmin = () => { need(); if (cur.role !== 'admin') throw new Error('Administrator access only.'); };
  switch (action) {
    case 'status': return { ok:true, dev:CFG.developer, max:MAXU, user:cur ? pub(cur) : null };
    case 'login': {
      const f = failState();
      if (f.n >= MAX_FAILS) throw new Error('Too many failed attempts. Please wait 15 minutes and try again.');
      const un = String(body.username || '').trim().toLowerCase(), pw = String(body.password || '');
      const a = published().find(x => x.username === un);
      const ok = a ? (await hashPw(pw, a.salt)) === a.hash : (await hashPw(pw, '00000000000000000000000000000000'), false);
      if (!ok) { store.set('ss_fail', JSON.stringify({ n:f.n + 1, t:Date.now() })); throw new Error('Wrong username or password.'); }
      if (a.active === false) throw new Error('This account is disabled. Please contact the administrator.');
      store.del('ss_fail'); store.set('ss_sess', JSON.stringify({ u:a.username, t:Date.now() }));
      return { ok:true, user:pub(a) };
    }
    case 'logout': store.del('ss_sess'); return { ok:true };
    case 'load': { need(); let d = null; try { d = JSON.parse(store.get('ss_data_' + cur.username)); } catch(e){} return { ok:true, data:d }; }
    case 'save': need(); store.set('ss_data_' + cur.username, JSON.stringify(body.data)); return { ok:true };
    case 'admin_users': { needAdmin(); const d = getDraft(); return { ok:true, max:MAXU, version:CFG.version, dirty:!!d, users:draftList().map(pub) }; }
    case 'admin_create': {
      needAdmin(); const list = draftList();
      if (list.filter(a => a.role !== 'admin').length >= MAXU) throw new Error('You have reached the limit of ' + MAXU + ' users. Delete a user to add another.');
      const name = String(body.name || '').trim().slice(0, 60), un = String(body.username || '').trim().toLowerCase(), pw = String(body.password || '');
      if (!name) throw new Error("Please enter the user's name.");
      if (!/^[a-z0-9._-]{3,30}$/.test(un)) throw new Error('Username must be 3-30 characters: letters, numbers, dot, dash or underscore.');
      if (list.some(a => a.username === un)) throw new Error('That username is already taken.');
      if (pw.length < 6) throw new Error('Password must be at least 6 characters.');
      const salt = newSalt();
      list.push({ username:un, name, role:'user', salt, hash:await hashPw(pw, salt), active:true });
      putDraft(list); return { ok:true };
    }
    case 'admin_update': {
      needAdmin(); const list = draftList(), a = list.find(x => x.username === body.id);
      if (!a) throw new Error('User not found.');
      if (typeof body.active === 'boolean') { if (a.role === 'admin' && !body.active) throw new Error('The administrator account cannot be disabled.'); a.active = body.active; }
      if (body.password) {
        if (String(body.password).length < (a.role === 'admin' ? 8 : 6)) throw new Error('Password must be at least ' + (a.role === 'admin' ? 8 : 6) + ' characters.');
        a.salt = newSalt(); a.hash = await hashPw(String(body.password), a.salt); delete a.temp;
      }
      putDraft(list); return { ok:true };
    }
    case 'admin_delete': {
      needAdmin(); const list = draftList(), a = list.find(x => x.username === body.id);
      if (!a) throw new Error('User not found.');
      if (a.role === 'admin') throw new Error('The administrator account cannot be deleted.');
      putDraft(list.filter(x => x !== a)); return { ok:true };
    }
    case 'admin_file': needAdmin(); return { ok:true, text:fileText(draftList(), CFG.version + 1) };
    case 'admin_discard': needAdmin(); store.del('ss_draft'); return { ok:true };
  }
  throw new Error('Unknown action.');
}
const fail = e => { if (e.message !== 'auth') toast(e.message, 'err'); };

/* ---------- Data ---------- */
function emptyDb() { return { settings: { business: 'My Business', currency: CURRENCY }, products: [], sales: [], movements: [] }; }
function normalize(d) {
  if (!d || !Array.isArray(d.products)) d = emptyDb();
  d.settings = Object.assign({ business: 'My Business' }, d.settings || {});
  d.settings.currency = CURRENCY;
  d.sales = d.sales || []; d.movements = d.movements || [];
  return d;
}
function seed() {
  const P = [
    ['SKU-001','Rice 25kg','Groceries',28000,35000,40,10,'AgriTrade'],
    ['SKU-002','Cooking Oil 5L','Groceries',14000,18000,8,12,'AgriTrade'],
    ['SKU-003','Sugar 2kg','Groceries',3200,4200,60,20,'SweetCo'],
    ['SKU-004','Bottled Water 500ml (24 pack)','Beverages',5500,8000,35,15,'AquaPure'],
    ['SKU-005','Orange Juice 1L','Beverages',1500,2500,0,10,'FreshSip'],
    ['SKU-006','Laundry Soap 1kg','Household',2500,3800,28,10,'CleanHome'],
    ['SKU-007','Dish Wash Liquid','Household',2000,3200,6,10,'CleanHome'],
    ['SKU-008','Notebook A4','Stationery',800,1500,90,30,'PaperWorld'],
    ['SKU-009','Ballpoint Pens (box)','Stationery',3000,5000,22,10,'PaperWorld'],
    ['SKU-010','USB Charger 20W','Electronics',6500,12000,14,8,'TechHub'],
    ['SKU-011','Earphones','Electronics',4000,8500,5,8,'TechHub'],
    ['SKU-012','LED Bulb 12W','Electronics',1500,3000,48,20,'TechHub']
  ].map(p => ({ id: uid(), sku:p[0], name:p[1], category:p[2], cost:p[3], price:p[4], qty:p[5], reorder:p[6], supplier:p[7], created:new Date().toISOString() }));

  const sales = [], movements = [];
  P.forEach(p => movements.push({ id:uid(), date:new Date(Date.now()-9*864e5).toISOString(), pid:p.id, name:p.name, type:'IN', qty:p.qty+25, note:'Opening stock' }));
  for (let d = 9; d >= 0; d--) {
    const n = 2 + Math.floor(Math.random()*4);
    for (let i = 0; i < n; i++) {
      const items = [], k = 1 + Math.floor(Math.random()*3);
      for (let j = 0; j < k; j++) {
        const p = P[Math.floor(Math.random()*P.length)];
        if (items.find(x => x.pid === p.id)) continue;
        items.push({ pid:p.id, name:p.name, qty:1+Math.floor(Math.random()*4), price:p.price, cost:p.cost });
      }
      const dt = new Date(Date.now() - d*864e5 - Math.random()*5e7);
      sales.push({ id:uid(), date:dt.toISOString(), customer:['Walk-in','Walk-in','Mary K.','John D.','Sunrise Café'][Math.floor(Math.random()*5)], items,
        total: items.reduce((s,x)=>s+x.qty*x.price,0), profit: items.reduce((s,x)=>s+x.qty*(x.price-x.cost),0) });
      items.forEach(x => movements.push({ id:uid(), date:dt.toISOString(), pid:x.pid, name:x.name, type:'SALE', qty:x.qty, note:'Sale' }));
    }
  }
  return { settings:{ business:'My Business', currency:CURRENCY }, products:P, sales, movements };
}
let saving = false, again = false;
function save() {
  if (!db) return;
  if (saving) { again = true; return; }
  saving = true;
  api('save', { data: db })
    .catch(e => { if (e.message !== 'auth') toast('⚠ Could not save to the server: ' + e.message, 'err'); })
    .finally(() => { saving = false; if (again) { again = false; save(); } });
}

/* ---------- Helpers ---------- */
const money = n => { try { return new Intl.NumberFormat('en-US',{style:'currency',currency:CURRENCY,maximumFractionDigits:0}).format(n||0); } catch(e){ return CURRENCY + ' ' + Math.round(n||0); } };
const num = n => new Intl.NumberFormat('en-US').format(n||0);
const dkey = d => { d = new Date(d); return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'); };
const ftime = d => d ? new Date(d).toLocaleString(undefined,{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'}) : '—';
const status = p => p.qty <= 0 ? 'out' : p.qty <= p.reorder ? 'low' : 'ok';
const statusBadge = p => ({ok:'<span class="badge b-ok">In stock</span>',low:'<span class="badge b-low">Low stock</span>',out:'<span class="badge b-out">Out of stock</span>'})[status(p)];
const categories = () => [...new Set(db.products.map(p => p.category))].sort();
const inDays = n => { const t = Date.now() - n*864e5; return db.sales.filter(s => +new Date(s.date) >= t); };

function toast(msg, type = '') {
  const t = document.createElement('div'); t.className = 'toast ' + type; t.textContent = msg;
  $('#toasts').appendChild(t); setTimeout(() => t.remove(), 3600);
}
function download(name, text, mime = 'text/csv') {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: mime })); a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 500);
}
const csvCell = v => '"' + String(v ?? '').replace(/"/g,'""') + '"';
const toCSV = rows => rows.map(r => r.map(csvCell).join(',')).join('\n');
function genPassword() {
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789', a = new Uint32Array(10);
  crypto.getRandomValues(a); return [...a].map(x => chars[x % chars.length]).join('');
}
function copyText(t) { try { navigator.clipboard.writeText(t); toast('Copied', 'ok'); } catch (e) { toast('Select the text and copy it manually'); } }

/* ---------- Modal ---------- */
let modalHandler = null;
function openModal(title, body, opts = {}) {
  $('#modalTitle').textContent = title;
  $('#modalBody').innerHTML = body;
  $('#modal .modal-box').classList.toggle('wide', !!opts.wide);
  $('#modalSubmit').textContent = opts.submitText || 'Save';
  $('#modalFooter').style.display = opts.hideFooter ? 'none' : 'flex';
  modalHandler = opts.onSubmit || null;
  $('#modal').classList.add('open');
  const f = $('#modalBody input, #modalBody select'); if (f && !opts.noFocus) f.focus();
}
function closeModal() { $('#modal').classList.remove('open'); modalHandler = null; }
$('#modalForm').addEventListener('submit', e => {
  e.preventDefault();
  if (modalHandler && modalHandler(new FormData(e.target)) !== false) closeModal();
});
$('#modalClose').onclick = $('#modalCancel').onclick = closeModal;
$('#modal').addEventListener('mousedown', e => { if (e.target.id === 'modal') closeModal(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });

/* ---------- Charts (plain canvas) ---------- */
function prep(canvas, h) {
  const dpr = window.devicePixelRatio || 1, w = canvas.parentElement.clientWidth;
  canvas.width = w*dpr; canvas.height = h*dpr; canvas.style.width = w+'px'; canvas.style.height = h+'px';
  const x = canvas.getContext('2d'); x.scale(dpr, dpr); return { x, w, h };
}
function shortNum(n) { return n >= 1e9 ? (n/1e9).toFixed(1)+'B' : n >= 1e6 ? (n/1e6).toFixed(1)+'M' : n >= 1e3 ? (n/1e3).toFixed(n >= 1e5 ? 0 : 1)+'k' : n.toFixed(0); }
function barChart(canvas, labels, values, color = '#4f46e5') {
  const { x, w, h } = prep(canvas, 260);
  const padL = 56, padB = 30, padT = 14, padR = 10;
  const max = Math.max(...values, 1) * 1.15;
  x.font = '12px Segoe UI, Arial'; x.fillStyle = '#6b7690'; x.strokeStyle = '#e4e8f0'; x.lineWidth = 1;
  for (let i = 0; i <= 4; i++) {
    const y = padT + (h-padT-padB) * (i/4);
    x.beginPath(); x.moveTo(padL, y); x.lineTo(w-padR, y); x.stroke();
    x.textAlign = 'right'; x.fillText(shortNum(max*(1-i/4)), padL-8, y+4);
  }
  const bw = (w-padL-padR) / labels.length;
  labels.forEach((l, i) => {
    const bh = (h-padT-padB) * (values[i]/max), bx = padL + i*bw + bw*0.2, by = h-padB-bh, ww = bw*0.6;
    x.fillStyle = color; x.beginPath();
    x.roundRect ? x.roundRect(bx, by, ww, bh, 6) : x.rect(bx, by, ww, bh); x.fill();
    x.fillStyle = '#6b7690'; x.textAlign = 'center'; x.fillText(l, bx+ww/2, h-10);
  });
}
function donut(canvas, labels, values) {
  const size = 220, { x, w } = prep(canvas, size);
  const total = values.reduce((a,b)=>a+b,0) || 1, cx = w/2, cy = size/2, R = 90, r = 56;
  let a0 = -Math.PI/2;
  values.forEach((v, i) => {
    const a1 = a0 + (v/total)*Math.PI*2;
    x.beginPath(); x.arc(cx, cy, R, a0, a1); x.arc(cx, cy, r, a1, a0, true); x.closePath();
    x.fillStyle = COLORS[i % COLORS.length]; x.fill(); a0 = a1;
  });
  x.fillStyle = '#1b2437'; x.textAlign = 'center'; x.font = '700 15px Segoe UI, Arial';
  x.fillText(CURRENCY + ' ' + shortNum(values.reduce((a,b)=>a+b,0)), cx, cy+2);
  x.font = '11px Segoe UI, Arial'; x.fillStyle = '#6b7690'; x.fillText('stock value', cx, cy+18);
}
function lineChart(canvas, labels, a, b) {
  const { x, w, h } = prep(canvas, 260);
  const padL = 56, padB = 30, padT = 14, padR = 14;
  const max = Math.max(...a, ...b, 1) * 1.15;
  x.font = '12px Segoe UI, Arial'; x.strokeStyle = '#e4e8f0'; x.lineWidth = 1;
  for (let i = 0; i <= 4; i++) {
    const y = padT + (h-padT-padB)*(i/4);
    x.beginPath(); x.moveTo(padL,y); x.lineTo(w-padR,y); x.stroke();
    x.fillStyle = '#6b7690'; x.textAlign = 'right'; x.fillText(shortNum(max*(1-i/4)), padL-8, y+4);
  }
  const step = labels.length > 1 ? (w-padL-padR)/(labels.length-1) : 0;
  const pt = (v,i) => [padL + i*step, h-padB - (h-padT-padB)*(v/max)];
  [[a,'#4f46e5'],[b,'#12a150']].forEach(([s, c]) => {
    x.beginPath(); s.forEach((v,i) => { const [px,py] = pt(v,i); i ? x.lineTo(px,py) : x.moveTo(px,py); });
    x.strokeStyle = c; x.lineWidth = 2.5; x.stroke();
    s.forEach((v,i) => { const [px,py] = pt(v,i); x.beginPath(); x.arc(px,py,3.5,0,7); x.fillStyle = c; x.fill(); });
  });
  const every = Math.ceil(labels.length/8);
  x.fillStyle = '#6b7690'; x.textAlign = 'center';
  labels.forEach((l,i) => { if (i % every === 0) x.fillText(l, padL+i*step, h-10); });
}

/* ---------- Routing ---------- */
const views = { dashboard, products, sales, movements, reports, settings, admin };
const titles = { dashboard:'Dashboard', products:'Products', sales:'Sales', movements:'Stock Movements', reports:'Reports', settings:'Settings', admin:'Admin Panel' };
let current = 'dashboard';

function route() {
  if (!db) return;
  let v = location.hash.slice(1) || 'dashboard';
  if (!views[v] || (v === 'admin' && me.role !== 'admin')) v = 'dashboard';
  current = v;
  $$('.nav a').forEach(a => a.classList.toggle('active', a.dataset.view === current));
  $('#pageTitle').textContent = titles[current];
  $('#sidebar').classList.remove('open');
  render();
}
function render() {
  if (!db) return;
  $('#bizName').textContent = db.settings.business;
  const low = db.products.filter(p => status(p) !== 'ok').length;
  const pill = $('#sideAlert'); pill.classList.toggle('show', low > 0); pill.textContent = '⚠ ' + low + ' item' + (low === 1 ? '' : 's') + ' need restocking';
  views[current]();
}

/* ---------- Dashboard ---------- */
function dashboard() {
  const P = db.products;
  const stockCost = P.reduce((s,p) => s + p.qty*p.cost, 0);
  const s30 = inDays(30), rev = s30.reduce((s,x)=>s+x.total,0), prof = s30.reduce((s,x)=>s+x.profit,0);
  const low = P.filter(p => status(p) === 'low'), out = P.filter(p => status(p) === 'out');
  const todayK = dkey(new Date()), todaySales = db.sales.filter(s => dkey(s.date) === todayK);
  const margin = rev ? prof/rev*100 : 0;

  const days = [], vals = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(Date.now() - i*864e5), k = dkey(d);
    days.push(d.toLocaleDateString(undefined,{weekday:'short'}));
    vals.push(db.sales.filter(s => dkey(s.date) === k).reduce((s,x)=>s+x.total,0));
  }
  const cat = {}; P.forEach(p => cat[p.category] = (cat[p.category]||0) + p.qty*p.cost);
  const catL = Object.keys(cat), catV = catL.map(k => cat[k]);
  const sold = {}; s30.forEach(s => s.items.forEach(i => { sold[i.name] = (sold[i.name]||0) + i.qty; }));
  const top = Object.entries(sold).sort((a,b)=>b[1]-a[1]).slice(0,5), topMax = top.length ? top[0][1] : 1;

  const insights = [];
  if (out.length) insights.push(`<div class="insight bad">⛔ <div><b>${out.length} product${out.length>1?'s are':' is'} out of stock:</b> ${out.slice(0,3).map(p=>esc(p.name)).join(', ')}${out.length>3?'…':''}. You may be losing sales.</div></div>`);
  if (low.length) insights.push(`<div class="insight warn">⚠ <div><b>${low.length} product${low.length>1?'s are':' is'} running low.</b> Reorder soon to avoid stock-outs.</div></div>`);
  if (rev && margin >= 25) insights.push(`<div class="insight good">✔ <div>Healthy profit margin of <b>${margin.toFixed(1)}%</b> over the last 30 days.</div></div>`);
  else if (rev) insights.push(`<div class="insight info">ℹ <div>Your profit margin is <b>${margin.toFixed(1)}%</b>. Review prices on low-margin items in Reports.</div></div>`);
  if (!insights.length) insights.push('<div class="insight info">ℹ <div>Add your products and record sales to see smart insights here. You can also load demo data in Settings.</div></div>');

  $('#view').innerHTML = `
  <div class="grid kpis">
    ${kpi('▤','c-indigo','Total Products', num(P.length), num(P.reduce((s,p)=>s+p.qty,0))+' units in stock')}
    ${kpi('◈','c-blue','Stock Value (cost)', money(stockCost), 'Money tied up in stock')}
    ${kpi('$','c-green','Revenue (30 days)', money(rev), money(todaySales.reduce((s,x)=>s+x.total,0))+' today')}
    ${kpi('↗','c-green','Profit (30 days)', money(prof), margin.toFixed(1)+'% margin')}
    ${kpi('⚠','c-amber','Low Stock', low.length, 'Items to reorder')}
    ${kpi('⛔','c-red','Out of Stock', out.length, 'Unavailable items')}
  </div>
  <div class="grid two" style="margin-bottom:18px">
    <div class="card"><div class="card-head"><h3>Sales – last 7 days</h3><small>Revenue per day</small></div><div class="chart-wrap"><canvas id="c1"></canvas></div></div>
    <div class="card"><div class="card-head"><h3>Stock value by category</h3></div><div class="chart-wrap"><canvas id="c2"></canvas></div>
      <div class="legend">${catL.map((c,i)=>`<span><i style="background:${COLORS[i%COLORS.length]}"></i>${esc(c)}</span>`).join('')}</div></div>
  </div>
  <div class="grid two-eq" style="margin-bottom:18px">
    <div class="card"><div class="card-head"><h3>Smart insights</h3></div>${insights.join('')}</div>
    <div class="card"><div class="card-head"><h3>Best sellers</h3><small>Last 30 days</small></div>
      ${top.length ? top.map(([n,q])=>`<div style="margin-bottom:12px"><div class="list-item" style="border:0;padding:0"><span class="pname">${esc(n)}</span><b>${q} sold</b></div><div class="bar"><i style="width:${q/topMax*100}%"></i></div></div>`).join('') : '<div class="empty">No sales yet</div>'}
    </div>
  </div>
  <div class="grid two-eq">
    <div class="card"><div class="card-head"><h3>Needs restocking</h3><a class="btn sm" href="#products">View all</a></div>
      ${[...out,...low].slice(0,6).map(p=>`<div class="list-item"><div><div class="pname">${esc(p.name)}</div><div class="psub">${esc(p.supplier||'—')} · reorder at ${p.reorder}</div></div><div>${statusBadge(p)} <b style="margin-left:8px">${p.qty}</b></div></div>`).join('') || '<div class="empty">All stock levels are healthy 🎉</div>'}
    </div>
    <div class="card"><div class="card-head"><h3>Recent sales</h3><a class="btn sm" href="#sales">View all</a></div>
      ${[...db.sales].sort((a,b)=>new Date(b.date)-new Date(a.date)).slice(0,6).map(s=>`<div class="list-item"><div><div class="pname">${esc(s.customer)}</div><div class="psub">${ftime(s.date)} · ${s.items.length} item(s)</div></div><b>${money(s.total)}</b></div>`).join('') || '<div class="empty">No sales yet</div>'}
    </div>
  </div>`;
  barChart($('#c1'), days, vals);
  donut($('#c2'), catL, catV);
}
const kpi = (ic, cls, lbl, val, sub) => `<div class="kpi"><div class="badge-ic ${cls}">${ic}</div><div><div class="lbl">${lbl}</div><div class="val">${val}</div><div class="sub">${sub}</div></div></div>`;

/* ---------- Products ---------- */
let pf = { q:'', cat:'', st:'' };
function products() {
  $('#view').innerHTML = `
  <div class="card">
    <div class="toolbar">
      <input class="grow" id="q" placeholder="Search by name, SKU or supplier…" value="${esc(pf.q)}">
      <select id="fc"><option value="">All categories</option>${categories().map(c=>`<option ${pf.cat===c?'selected':''}>${esc(c)}</option>`).join('')}</select>
      <select id="fs"><option value="">All status</option><option value="ok" ${pf.st==='ok'?'selected':''}>In stock</option><option value="low" ${pf.st==='low'?'selected':''}>Low stock</option><option value="out" ${pf.st==='out'?'selected':''}>Out of stock</option></select>
      <button class="btn" id="exp">⬇ Export CSV</button>
      <button class="btn primary" id="add">+ Add Product</button>
    </div>
    <div class="table-wrap"><table>
      <thead><tr><th>Product</th><th>Category</th><th class="num">Cost</th><th class="num">Price</th><th class="num">Qty</th><th>Status</th><th></th></tr></thead>
      <tbody id="pbody"></tbody>
    </table></div>
  </div>`;
  const draw = () => {
    const q = pf.q.toLowerCase();
    const rows = db.products.filter(p =>
      (!q || [p.name,p.sku,p.supplier].join(' ').toLowerCase().includes(q)) &&
      (!pf.cat || p.category === pf.cat) && (!pf.st || status(p) === pf.st));
    $('#pbody').innerHTML = rows.map(p => `<tr>
      <td><div class="pname">${esc(p.name)}</div><div class="psub">${esc(p.sku)} · ${esc(p.supplier||'—')}</div></td>
      <td>${esc(p.category)}</td><td class="num">${money(p.cost)}</td><td class="num">${money(p.price)}</td>
      <td class="num"><b>${p.qty}</b></td><td>${statusBadge(p)}</td>
      <td><div class="actions">
        <button class="btn sm" data-a="in" data-id="${p.id}">+ Stock</button>
        <button class="btn sm" data-a="out" data-id="${p.id}">− Stock</button>
        <button class="btn sm" data-a="edit" data-id="${p.id}">Edit</button>
        <button class="btn sm danger" data-a="del" data-id="${p.id}">Delete</button></div></td></tr>`).join('')
      || '<tr><td colspan="7" class="empty">No products found. Click “Add Product” to start.</td></tr>';
  };
  draw();
  $('#q').oninput = e => { pf.q = e.target.value; draw(); };
  $('#fc').onchange = e => { pf.cat = e.target.value; draw(); };
  $('#fs').onchange = e => { pf.st = e.target.value; draw(); };
  $('#add').onclick = () => productForm();
  $('#exp').onclick = () => download('products.csv', toCSV([['SKU','Name','Category','Supplier','Cost','Price','Qty','Reorder level'], ...db.products.map(p=>[p.sku,p.name,p.category,p.supplier,p.cost,p.price,p.qty,p.reorder])]));
  $('#pbody').onclick = e => {
    const b = e.target.closest('button'); if (!b) return;
    const p = db.products.find(x => x.id === b.dataset.id); if (!p) return;
    if (b.dataset.a === 'edit') productForm(p);
    if (b.dataset.a === 'in' || b.dataset.a === 'out') stockForm(p, b.dataset.a.toUpperCase());
    if (b.dataset.a === 'del' && confirm(`Delete "${p.name}"? Its sales history is kept.`)) { db.products = db.products.filter(x => x.id !== p.id); save(); toast('Product deleted'); render(); }
  };
}
function productForm(p) {
  const e = !!p; p = p || { sku:'SKU-'+String(db.products.length+1).padStart(3,'0'), name:'', category:'', supplier:'', cost:'', price:'', qty:0, reorder:10 };
  openModal(e ? 'Edit product' : 'Add product', `
    <div class="row"><div class="field"><label>Product name *</label><input name="name" required value="${esc(p.name)}"></div>
    <div class="field"><label>SKU / Code *</label><input name="sku" required value="${esc(p.sku)}"></div></div>
    <div class="row"><div class="field"><label>Category *</label><input name="category" required list="cats" value="${esc(p.category)}"><datalist id="cats">${categories().map(c=>`<option value="${esc(c)}">`).join('')}</datalist></div>
    <div class="field"><label>Supplier</label><input name="supplier" value="${esc(p.supplier)}"></div></div>
    <div class="row"><div class="field"><label>Cost price (${CURRENCY}) *</label><input name="cost" type="number" step="1" min="0" required value="${p.cost}"></div>
    <div class="field"><label>Selling price (${CURRENCY}) *</label><input name="price" type="number" step="1" min="0" required value="${p.price}"></div></div>
    <div class="row"><div class="field"><label>${e?'Quantity in stock':'Opening quantity'}</label><input name="qty" type="number" min="0" step="1" value="${p.qty}"></div>
    <div class="field"><label>Reorder level (alert when at or below)</label><input name="reorder" type="number" min="0" step="1" value="${p.reorder}"></div></div>`,
    { onSubmit: f => {
      const d = { name:f.get('name').trim(), sku:f.get('sku').trim(), category:f.get('category').trim(), supplier:f.get('supplier').trim(),
        cost:+f.get('cost'), price:+f.get('price'), qty:Math.max(0,parseInt(f.get('qty'))||0), reorder:Math.max(0,parseInt(f.get('reorder'))||0) };
      if (db.products.some(x => x.sku.toLowerCase() === d.sku.toLowerCase() && x.id !== p.id)) { toast('That SKU already exists', 'err'); return false; }
      if (e) {
        if (d.qty !== p.qty) db.movements.push({ id:uid(), date:new Date().toISOString(), pid:p.id, name:d.name, type:'ADJUST', qty:d.qty-p.qty, note:'Manual edit' });
        Object.assign(p, d);
      } else {
        const np = { id:uid(), ...d, created:new Date().toISOString() }; db.products.push(np);
        if (d.qty) db.movements.push({ id:uid(), date:new Date().toISOString(), pid:np.id, name:np.name, type:'IN', qty:d.qty, note:'Opening stock' });
      }
      save(); toast(e ? 'Product updated' : 'Product added', 'ok'); render();
    }});
}
function stockForm(p, type) {
  openModal((type === 'IN' ? 'Add stock – ' : 'Remove stock – ') + p.name, `
    <p class="hint" style="margin-bottom:12px">Current quantity: <b>${p.qty}</b></p>
    <div class="field"><label>Quantity *</label><input name="qty" type="number" min="1" step="1" required></div>
    <div class="field"><label>Note / reason</label><input name="note" placeholder="${type==='IN'?'e.g. Delivery from supplier':'e.g. Damaged, expired, own use'}"></div>`,
    { submitText: type === 'IN' ? 'Add stock' : 'Remove stock', onSubmit: f => {
      const q = parseInt(f.get('qty')) || 0;
      if (q < 1) return false;
      if (type === 'OUT' && q > p.qty) { toast('Not enough stock to remove', 'err'); return false; }
      p.qty += type === 'IN' ? q : -q;
      db.movements.push({ id:uid(), date:new Date().toISOString(), pid:p.id, name:p.name, type, qty:q, note:f.get('note') || (type==='IN'?'Stock received':'Stock removed') });
      save(); toast('Stock updated', 'ok'); render();
    }});
}

/* ---------- Sales ---------- */
function sales() {
  const list = [...db.sales].sort((a,b) => new Date(b.date) - new Date(a.date));
  $('#view').innerHTML = `
  <div class="card">
    <div class="toolbar"><div class="grow"><b>${list.length}</b> sales recorded</div>
      <button class="btn" id="exp">⬇ Export CSV</button><button class="btn primary" id="new">+ New Sale</button></div>
    <div class="table-wrap"><table>
      <thead><tr><th>Date</th><th>Customer</th><th>Items</th><th class="num">Total</th><th class="num">Profit</th><th></th></tr></thead>
      <tbody>${list.map(s => `<tr><td>${ftime(s.date)}</td><td>${esc(s.customer)}</td>
        <td class="psub">${s.items.map(i=>esc(i.name)+' ×'+i.qty).join(', ')}</td>
        <td class="num"><b>${money(s.total)}</b></td><td class="num pos">${money(s.profit)}</td>
        <td><div class="actions"><button class="btn sm" data-id="${s.id}">Receipt</button></div></td></tr>`).join('')
        || '<tr><td colspan="6" class="empty">No sales yet. Click “New Sale”.</td></tr>'}</tbody>
    </table></div>
  </div>`;
  $('#new').onclick = saleForm;
  $('#exp').onclick = () => download('sales.csv', toCSV([['Date','Customer','Product','Qty','Unit price','Line total'], ...db.sales.flatMap(s => s.items.map(i => [s.date,s.customer,i.name,i.qty,i.price,i.qty*i.price]))]));
  $$('tbody button').forEach(b => b.onclick = () => receipt(db.sales.find(s => s.id === b.dataset.id)));
}
function receipt(s) {
  openModal('Receipt', `
    <p><b>${esc(db.settings.business)}</b><br><span class="psub">${ftime(s.date)} · Customer: ${esc(s.customer)}</span></p>
    <table style="margin:12px 0"><thead><tr><th>Item</th><th class="num">Qty</th><th class="num">Price</th><th class="num">Total</th></tr></thead>
    <tbody>${s.items.map(i=>`<tr><td>${esc(i.name)}</td><td class="num">${i.qty}</td><td class="num">${money(i.price)}</td><td class="num">${money(i.qty*i.price)}</td></tr>`).join('')}</tbody></table>
    <div class="total-line"><span>Total</span><span>${money(s.total)}</span></div>`,
    { hideFooter:true });
}
function saleForm() {
  if (!db) return;
  const avail = db.products.filter(p => p.qty > 0);
  if (!avail.length) { toast('No products in stock to sell. Add products first.', 'err'); return; }
  let cart = [];
  openModal('New sale', `
    <div class="field"><label>Customer</label><input name="customer" placeholder="Walk-in"></div>
    <div class="row3" style="align-items:end">
      <div class="field"><label>Product</label><select id="sp">${avail.map(p=>`<option value="${p.id}">${esc(p.name)} (${p.qty} left)</option>`).join('')}</select></div>
      <div class="field"><label>Quantity</label><input id="sq" type="number" min="1" value="1"></div>
      <div class="field"><button type="button" class="btn primary" id="sa" style="width:100%;justify-content:center">Add to sale</button></div>
    </div>
    <div class="cart-box"><div id="cart"></div></div>`,
    { wide:true, submitText:'Complete sale', noFocus:true, onSubmit: f => {
      if (!cart.length) { toast('Add at least one product', 'err'); return false; }
      const items = cart.map(c => { const p = db.products.find(x => x.id === c.pid); return { pid:p.id, name:p.name, qty:c.qty, price:p.price, cost:p.cost }; });
      for (const i of items) { const p = db.products.find(x => x.id === i.pid); if (i.qty > p.qty) { toast('Not enough stock for ' + p.name, 'err'); return false; } }
      const now = new Date().toISOString();
      items.forEach(i => { db.products.find(x => x.id === i.pid).qty -= i.qty; db.movements.push({ id:uid(), date:now, pid:i.pid, name:i.name, type:'SALE', qty:i.qty, note:'Sale' }); });
      const sale = { id:uid(), date:now, customer:(f.get('customer')||'').trim() || 'Walk-in', items,
        total: items.reduce((s,i)=>s+i.qty*i.price,0), profit: items.reduce((s,i)=>s+i.qty*(i.price-i.cost),0) };
      db.sales.push(sale); save(); toast('Sale completed: ' + money(sale.total), 'ok'); render();
      setTimeout(() => receipt(sale), 50);
    }});
  const drawCart = () => {
    const rows = cart.map((c,i) => { const p = db.products.find(x => x.id === c.pid);
      return `<div class="list-item"><div><div class="pname">${esc(p.name)}</div><div class="psub">${c.qty} × ${money(p.price)}</div></div>
      <div><b>${money(c.qty*p.price)}</b> <button type="button" class="btn sm danger" data-i="${i}">✕</button></div></div>`; }).join('');
    const total = cart.reduce((s,c) => s + c.qty*db.products.find(x => x.id === c.pid).price, 0);
    $('#cart').innerHTML = (rows || '<div class="psub" style="padding:6px 0">No items added yet</div>') + `<div class="total-line"><span>Total</span><span>${money(total)}</span></div>`;
    $$('#cart [data-i]').forEach(b => b.onclick = () => { cart.splice(+b.dataset.i, 1); drawCart(); });
  };
  drawCart();
  $('#sa').onclick = () => {
    const pid = $('#sp').value, q = parseInt($('#sq').value) || 0, p = db.products.find(x => x.id === pid);
    const inCart = (cart.find(c => c.pid === pid) || {}).qty || 0;
    if (q < 1) return;
    if (inCart + q > p.qty) { toast('Only ' + p.qty + ' in stock', 'err'); return; }
    const ex = cart.find(c => c.pid === pid); ex ? ex.qty += q : cart.push({ pid, qty:q });
    $('#sq').value = 1; drawCart();
  };
}

/* ---------- Stock movements ---------- */
function movements() {
  $('#view').innerHTML = `<div class="card">
    <div class="toolbar"><input class="grow" id="q" placeholder="Search product or note…">
      <select id="ft"><option value="">All types</option><option value="IN">Stock in</option><option value="OUT">Stock out</option><option value="SALE">Sales</option><option value="ADJUST">Adjustments</option></select></div>
    <div class="table-wrap"><table><thead><tr><th>Date</th><th>Product</th><th>Type</th><th class="num">Qty</th><th>Note</th></tr></thead><tbody id="mb"></tbody></table></div></div>`;
  const draw = () => {
    const q = $('#q').value.toLowerCase(), t = $('#ft').value;
    const rows = [...db.movements].sort((a,b) => new Date(b.date)-new Date(a.date))
      .filter(m => (!t || m.type === t) && (!q || (m.name + ' ' + m.note).toLowerCase().includes(q))).slice(0, 300);
    const badge = { IN:'<span class="badge b-in">Stock in</span>', OUT:'<span class="badge b-out">Stock out</span>', SALE:'<span class="badge b-sale">Sale</span>', ADJUST:'<span class="badge b-low">Adjust</span>' };
    $('#mb').innerHTML = rows.map(m => { const plus = m.type==='IN'||(m.type==='ADJUST'&&m.qty>0);
      return `<tr><td>${ftime(m.date)}</td><td class="pname">${esc(m.name)}</td><td>${badge[m.type]}</td>
      <td class="num ${plus?'pos':'neg'}">${plus?'+':'−'}${Math.abs(m.qty)}</td><td class="psub">${esc(m.note)}</td></tr>`; }).join('')
      || '<tr><td colspan="5" class="empty">No movements found</td></tr>';
  };
  $('#q').oninput = draw; $('#ft').onchange = draw; draw();
}

/* ---------- Reports ---------- */
let rp = 30;
function reports() {
  const list = rp === 0 ? db.sales : inDays(rp);
  const rev = list.reduce((s,x)=>s+x.total,0), prof = list.reduce((s,x)=>s+x.profit,0);
  const units = list.reduce((s,x)=>s+x.items.reduce((a,i)=>a+i.qty,0),0);
  const byProd = {}, byCat = {};
  list.forEach(s => s.items.forEach(i => {
    const p = db.products.find(x => x.id === i.pid), cat = p ? p.category : 'Other';
    const r = byProd[i.name] = byProd[i.name] || { qty:0, rev:0, prof:0 };
    r.qty += i.qty; r.rev += i.qty*i.price; r.prof += i.qty*(i.price-i.cost);
    const c = byCat[cat] = byCat[cat] || { rev:0, prof:0 }; c.rev += i.qty*i.price; c.prof += i.qty*(i.price-i.cost);
  }));
  const rows = Object.entries(byProd).sort((a,b)=>b[1].rev-a[1].rev);
  const slow = db.products.filter(p => !byProd[p.name] && p.qty > 0);
  const n = rp === 0 ? 30 : Math.min(rp, 30), labels = [], rv = [], pf2 = [];
  for (let i = n-1; i >= 0; i--) {
    const d = new Date(Date.now() - i*864e5), k = dkey(d), ds = db.sales.filter(s => dkey(s.date) === k);
    labels.push(d.toLocaleDateString(undefined,{day:'numeric',month:'short'}));
    rv.push(ds.reduce((s,x)=>s+x.total,0)); pf2.push(ds.reduce((s,x)=>s+x.profit,0));
  }
  $('#view').innerHTML = `
  <div class="toolbar"><select id="per" style="min-width:180px"><option value="7">Last 7 days</option><option value="30">Last 30 days</option><option value="90">Last 90 days</option><option value="0">All time</option></select>
    <div class="grow"></div><button class="btn" onclick="window.print()">🖨 Print</button></div>
  <div class="grid kpis">
    ${kpi('$','c-indigo','Revenue', money(rev), list.length+' sales')}
    ${kpi('↗','c-green','Profit', money(prof), (rev?prof/rev*100:0).toFixed(1)+'% margin')}
    ${kpi('▤','c-blue','Units sold', num(units), 'Across '+rows.length+' products')}
    ${kpi('◔','c-amber','Avg. sale', money(list.length?rev/list.length:0), 'Per transaction')}
  </div>
  <div class="card" style="margin-bottom:18px"><div class="card-head"><h3>Revenue vs profit (daily)</h3>
    <div class="legend" style="margin:0"><span><i style="background:#4f46e5"></i>Revenue</span><span><i style="background:#12a150"></i>Profit</span></div></div>
    <div class="chart-wrap"><canvas id="c3"></canvas></div></div>
  <div class="grid two-eq">
    <div class="card"><div class="card-head"><h3>Product performance</h3></div><div class="table-wrap"><table>
      <thead><tr><th>Product</th><th class="num">Sold</th><th class="num">Revenue</th><th class="num">Profit</th></tr></thead>
      <tbody>${rows.slice(0,10).map(([n,r])=>`<tr><td class="pname">${esc(n)}</td><td class="num">${r.qty}</td><td class="num">${money(r.rev)}</td><td class="num pos">${money(r.prof)}</td></tr>`).join('') || '<tr><td colspan="4" class="empty">No sales in this period</td></tr>'}</tbody></table></div></div>
    <div class="card"><div class="card-head"><h3>Category performance</h3></div><div class="table-wrap"><table>
      <thead><tr><th>Category</th><th class="num">Revenue</th><th class="num">Profit</th></tr></thead>
      <tbody>${Object.entries(byCat).sort((a,b)=>b[1].rev-a[1].rev).map(([n,r])=>`<tr><td class="pname">${esc(n)}</td><td class="num">${money(r.rev)}</td><td class="num pos">${money(r.prof)}</td></tr>`).join('') || '<tr><td colspan="3" class="empty">No data</td></tr>'}</tbody></table></div>
      <div class="card-head" style="margin-top:20px"><h3>Slow movers</h3><small>In stock, no sales this period</small></div>
      ${slow.slice(0,6).map(p=>`<div class="list-item"><span>${esc(p.name)}</span><span class="psub">${p.qty} units · ${money(p.qty*p.cost)} tied up</span></div>`).join('') || '<div class="empty">Everything is selling 👍</div>'}
    </div>
  </div>`;
  $('#per').value = String(rp);
  $('#per').onchange = e => { rp = +e.target.value; reports(); };
  lineChart($('#c3'), labels, rv, pf2);
}

/* ---------- Settings ---------- */
function settings() {
  $('#view').innerHTML = `
  <div class="grid two-eq">
    <div class="card"><div class="card-head"><h3>Business profile</h3></div>
      <form id="sf">
        <div class="field"><label>Business name</label><input name="business" value="${esc(db.settings.business)}" required></div>
        <div class="field"><label>Currency</label><input value="Rwandan Franc (${CURRENCY})" disabled></div>
        <button class="btn primary">Save settings</button>
      </form></div>
    <div class="card"><div class="card-head"><h3>My account</h3></div>
      <p>Signed in as <b>${esc(me.name)}</b> (${esc(me.username)}).</p>
      <p class="hint" style="margin-top:8px">Passwords are set by the administrator. To change yours, ask the administrator.</p></div>
    <div class="card"><div class="card-head"><h3>Data & backup</h3></div>
      <p class="hint" style="margin-bottom:14px">Your data is saved in this browser, on this device. If you clear your browser data or sign in on another device it will not be there, so download a backup regularly.</p>
      <div style="display:flex;gap:10px;flex-wrap:wrap">
        <button class="btn" id="bk">⬇ Download backup</button>
        <button class="btn" id="rs">⬆ Restore backup</button><input type="file" id="rf" accept=".json" hidden>
        <button class="btn" id="demo">Load demo data</button>
        <button class="btn danger" id="clr">Erase everything</button></div></div>
  </div>`;
  $('#sf').onsubmit = e => { e.preventDefault(); db.settings.business = new FormData(e.target).get('business').trim(); save(); toast('Settings saved', 'ok'); render(); };
  $('#bk').onclick = () => download('smartstock-backup-' + dkey(new Date()) + '.json', JSON.stringify(db), 'application/json');
  $('#rs').onclick = () => $('#rf').click();
  $('#rf').onchange = e => { const r = new FileReader(); r.onload = () => { try { const d = JSON.parse(r.result); if (!d.products || !d.sales) throw 0; db = normalize(d); save(); toast('Backup restored', 'ok'); render(); } catch (x) { toast('Invalid backup file', 'err'); } }; if (e.target.files[0]) r.readAsText(e.target.files[0]); };
  $('#demo').onclick = () => { if (confirm('Replace current data with demo data?')) { const b = db.settings.business; db = seed(); db.settings.business = b; save(); render(); toast('Demo data loaded', 'ok'); } };
  $('#clr').onclick = () => { if (confirm('Erase ALL products, sales and history? This cannot be undone.')) { db = { settings:db.settings, products:[], sales:[], movements:[] }; save(); render(); toast('All data erased'); } };
}

/* ---------- Admin panel ---------- */
async function admin() {
  $('#view').innerHTML = '<div class="card"><div class="empty">Loading users…</div></div>';
  let j; try { j = await api('admin_users'); } catch (e) { return fail(e); }
  if (current !== 'admin') return;
  maxUsers = j.max;
  const U = j.users, normal = U.filter(u => u.role === 'user'), active = normal.filter(u => u.active).length;
  $('#view').innerHTML = `
  ${me.temp ? `<div class="insight bad" style="margin-bottom:16px">⛔ <div><b>Change the temporary admin password now.</b> Click “Reset password” on your own row, then publish the change below. Until then anyone who knows the default password can sign in as administrator.</div></div>` : ''}
  ${j.dirty ? `<div class="insight warn" style="margin-bottom:16px;align-items:center;flex-wrap:wrap">⚠ <div style="flex:1;min-width:220px"><b>You have changes that are not live yet.</b> Users, passwords and disabled accounts only change when you upload the new accounts.js file to your website.</div>
    <button class="btn primary" id="pub">Publish changes</button><button class="btn" id="disc">Discard</button></div>` : ''}
  <div class="grid kpis">
    ${kpi('♛','c-indigo','User accounts', normal.length + ' / ' + j.max, (j.max - normal.length) + ' slot' + (j.max-normal.length===1?'':'s') + ' left')}
    ${kpi('✔','c-green','Active users', active, 'Allowed to sign in')}
    ${kpi('⛔','c-red','Disabled users', normal.length - active, 'Blocked from signing in')}
    ${kpi('▤','c-blue','accounts.js version', j.version, 'The file now on your website')}
  </div>
  <div class="card">
    <div class="meter"><i style="width:${normal.length/j.max*100}%"></i></div>
    <div class="toolbar" style="margin-top:16px"><div class="grow"><b>Manage who can use SmartStock.</b> <span class="psub">Each user's business data stays in their own browser. Changes go live when you upload accounts.js.</span></div>
      <button class="btn primary" id="addUser">+ Add user</button></div>
    <div class="table-wrap"><table>
      <thead><tr><th>Name</th><th>Username</th><th>Role</th><th>Status</th><th></th></tr></thead>
      <tbody>${U.map(u => `<tr>
        <td class="pname">${esc(u.name)}</td><td>${esc(u.username)}</td>
        <td>${u.role === 'admin' ? '<span class="badge b-sale">Admin</span>' : 'User'}</td>
        <td>${u.active ? '<span class="badge b-ok">Active</span>' : '<span class="badge b-out">Disabled</span>'}</td>
        <td><div class="actions">
          <button class="btn sm" data-a="pw" data-id="${esc(u.id)}">Reset password</button>
          ${u.role === 'admin' ? '' : `<button class="btn sm" data-a="toggle" data-id="${esc(u.id)}">${u.active ? 'Disable' : 'Enable'}</button>
          <button class="btn sm danger" data-a="del" data-id="${esc(u.id)}">Delete</button>`}</div></td></tr>`).join('')}</tbody>
    </table></div>
  </div>`;
  $('#addUser').onclick = () => userForm(normal.length);
  if ($('#pub')) $('#pub').onclick = publishModal;
  if ($('#disc')) $('#disc').onclick = () => { if (confirm('Discard all changes that are not live yet?')) api('admin_discard', {}).then(() => { toast('Changes discarded'); admin(); }).catch(fail); };
  $('#view tbody').onclick = e => {
    const b = e.target.closest('button'); if (!b) return;
    const u = U.find(x => x.id === b.dataset.id); if (!u) return;
    if (b.dataset.a === 'pw') pwForm(u);
    if (b.dataset.a === 'toggle') api('admin_update', { id:u.id, active:!u.active }).then(() => { toast(u.active ? 'User disabled' : 'User enabled', 'ok'); admin(); }).catch(fail);
    if (b.dataset.a === 'del' && confirm(`Delete ${u.name} (${u.username})? They will no longer be able to sign in once you publish.`))
      api('admin_delete', { id:u.id }).then(() => { toast('User deleted'); admin(); }).catch(fail);
  };
}
async function publishModal() {
  let j; try { j = await api('admin_file', {}); } catch (e) { return fail(e); }
  openModal('Publish changes', `
    <ol style="padding-left:20px;display:flex;flex-direction:column;gap:6px;margin-bottom:14px">
      <li>Click <b>Download accounts.js</b>.</li>
      <li>Upload it to your website folder (next to index.html) and <b>replace</b> the old accounts.js.</li>
      <li>Refresh this page. The changes are now live.</li></ol>
    <div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:12px"><button type="button" class="btn primary" id="dl">⬇ Download accounts.js</button><button type="button" class="btn" id="cpf">Copy file text</button></div>
    <textarea id="ftext" readonly rows="8" style="font-family:Consolas,monospace;font-size:12px">${esc(j.text)}</textarea>
    <p class="hint">The file contains scrambled (hashed) passwords, not the passwords themselves.</p>`, { wide:true, hideFooter:true, noFocus:true });
  $('#dl').onclick = () => download('accounts.js', j.text, 'text/javascript');
  $('#cpf').onclick = () => copyText(j.text);
}
function userForm(count) {
  if (count >= maxUsers) return toast('You have reached the limit of ' + maxUsers + ' users. Delete one to add another.', 'err');
  openModal('Add user', `
    <div class="field"><label>Full name / business *</label><input name="name" required></div>
    <div class="field"><label>Username * (letters, numbers, . _ -)</label><input name="username" required pattern="[A-Za-z0-9._\\-]{3,30}" autocapitalize="none"></div>
    <div class="field"><label>Password * (at least 6 characters)</label>
      <div class="pw-row"><input name="password" id="npw" required minlength="6" value="${genPassword()}"><button type="button" class="btn" id="gen">Generate</button></div></div>
    <p class="hint">You will see the login details after saving. The user can sign in after you publish the changes.</p>`,
    { submitText:'Create user', onSubmit: f => {
      const d = { name:f.get('name'), username:f.get('username'), password:f.get('password') };
      api('admin_create', d).then(() => { closeModal(); admin(); credentials(d.name, d.username, d.password, 'User created'); }).catch(fail);
      return false;
    }});
  $('#gen').onclick = () => { $('#npw').value = genPassword(); };
}
function pwForm(u) {
  const min = u.role === 'admin' ? 8 : 6;
  openModal('Reset password – ' + u.name, `
    <div class="field"><label>New password * (at least ${min} characters)</label>
      <div class="pw-row"><input name="password" id="npw" required minlength="${min}" value="${genPassword()}"><button type="button" class="btn" id="gen">Generate</button></div></div>`,
    { submitText:'Set password', onSubmit: f => {
      const pw = f.get('password');
      api('admin_update', { id:u.id, password:pw }).then(() => { closeModal(); admin(); credentials(u.name, u.username, pw, 'Password changed'); }).catch(fail);
      return false;
    }});
  $('#gen').onclick = () => { $('#npw').value = genPassword(); };
}
function credentials(name, username, password, title) {
  const url = location.origin + location.pathname.replace(/[^/]*$/, '');
  openModal(title, `
    <p>Give these login details to <b>${esc(name)}</b>. The password is shown only now.</p>
    <div class="cred"><div><span>Website</span><code>${esc(url)}</code></div><div><span>Username</span><code>${esc(username)}</code></div><div><span>Password</span><code>${esc(password)}</code></div></div>
    <p class="hint" style="margin-bottom:12px">These details work only after you click <b>Publish changes</b> and upload the new accounts.js.</p>
    <button type="button" class="btn" id="cp">Copy login details</button>`, { hideFooter:true });
  $('#cp').onclick = () => copyText(`SmartStock login\nWebsite: ${url}\nUsername: ${username}\nPassword: ${password}`);
}

/* ---------- Login / startup ---------- */
function showAuth(msg) {
  db = null; me = null;
  $('#appRoot').hidden = true; $('#auth').hidden = false; closeModal();
  const m = $('#authMsg'); m.textContent = msg || ''; m.hidden = !msg;
}
async function startApp() {
  const j = await api('load');
  db = normalize(j.data);
  $('#auth').hidden = true; $('#appRoot').hidden = false;
  $('#userName').textContent = me.name;
  $('#userRole').textContent = me.role === 'admin' ? 'Administrator' : 'User';
  $('#userAvatar').textContent = (me.name || 'U').trim().charAt(0).toUpperCase();
  $('#navAdmin').style.display = me.role === 'admin' ? '' : 'none';
  if (!location.hash) location.hash = me.role === 'admin' ? '#admin' : '#dashboard';
  route();
}
$('#showPw').onchange = e => { $('#lp').type = e.target.checked ? 'text' : 'password'; };
$('#loginForm').onsubmit = async e => {
  e.preventDefault(); const f = new FormData(e.target), btn = $('#loginBtn');
  btn.disabled = true; btn.textContent = 'Signing in…';
  try { const j = await api('login', { username:f.get('username'), password:f.get('password') }); me = j.user; e.target.reset(); await startApp(); }
  catch (x) { if (x.message !== 'auth') showAuth(x.message); }
  btn.disabled = false; btn.textContent = 'Sign in';
};
$('#logoutBtn').onclick = async () => {
  try { await api('logout', {}); } catch (e) {}
  location.hash = ''; showAuth('You have been signed out.');
};
$('#menuBtn').onclick = () => $('#sidebar').classList.toggle('open');
$('#quickSale').onclick = saleForm;
$('#todayChip').textContent = new Date().toLocaleDateString(undefined, { weekday:'long', day:'numeric', month:'long', year:'numeric' });
$$('.yr').forEach(n => n.textContent = new Date().getFullYear());
window.addEventListener('hashchange', route);
window.addEventListener('resize', () => { if (db && (current === 'dashboard' || current === 'reports')) render(); });

(async function boot() {
  try {
    const j = await api('status');
    maxUsers = j.max;
    $$('.dev-name').forEach(n => n.textContent = j.dev);
    if (j.user) { me = j.user; await startApp(); }
    else showAuth('');
  } catch (e) { $('#auth').hidden = false; const m = $('#authMsg'); m.textContent = e.message; m.hidden = false; }
})();
})();
