// Mbote SMS — serveur du dashboard (Node 18+, aucune dépendance)
// - sert le dashboard et le logo
// - relaie /api/* vers Infobip en ajoutant la clé API côté serveur
// - reçoit les accusés de réception d'Infobip en temps réel (/webhook/dlr)
// - protège l'accès par identifiant / mot de passe
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// ---------- configuration (.env) ----------
try {
  fs.readFileSync(path.join(__dirname, '.env'), 'utf8').split(/\r?\n/).forEach(l => {
    const m = l.match(/^\s*([\w.]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  });
} catch (e) {}

const BASE = (process.env.INFOBIP_BASE_URL || '').replace(/^https?:\/\//, '').replace(/\/$/, '');
const KEY = process.env.INFOBIP_API_KEY || '';
const USER = process.env.DASH_USER || 'admin';
const PASS = process.env.DASH_PASS || '';
const PORT = process.env.PORT || 3000;
const PUBLIC_URL = (process.env.PUBLIC_URL || '').replace(/\/$/, '');
const DATA = path.join(__dirname, 'data');

if (!BASE || !KEY) { console.error('INFOBIP_BASE_URL et INFOBIP_API_KEY sont requis dans .env'); process.exit(1); }
if (!PASS) console.warn('⚠  DASH_PASS vide : le dashboard est accessible sans mot de passe.');
fs.mkdirSync(DATA, { recursive: true });

// Jeton secret du webhook (généré une fois puis conservé)
let TOKEN = process.env.WEBHOOK_TOKEN;
const tokenFile = path.join(DATA, 'webhook-token.txt');
if (!TOKEN) {
  try { TOKEN = fs.readFileSync(tokenFile, 'utf8').trim(); } catch (e) {}
  if (!TOKEN) { TOKEN = crypto.randomBytes(18).toString('hex'); fs.writeFileSync(tokenFile, TOKEN); }
}
const NOTIFY_URL = PUBLIC_URL ? PUBLIC_URL + '/webhook/dlr?token=' + TOKEN : '';

// ---------- stockage des accusés de réception ----------
const reportsFile = path.join(DATA, 'reports.json');
let reports = {};
try { reports = JSON.parse(fs.readFileSync(reportsFile, 'utf8')); } catch (e) {}
let saveTimer;
function saveReports() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    const ids = Object.keys(reports);
    if (ids.length > 100000) ids.sort((a, b) => reports[a].receivedAt - reports[b].receivedAt).slice(0, ids.length - 100000).forEach(id => delete reports[id]);
    fs.writeFile(reportsFile, JSON.stringify(reports), () => {});
  }, 1000);
}

// ---------- utilitaires ----------
// ---------- SMS reçus et liste d'exclusion ----------
const loadJson = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { return d; } };
const timers = {};
const saveJson = (f, obj) => { clearTimeout(timers[f]); timers[f] = setTimeout(() => fs.writeFile(f, JSON.stringify(obj), () => {}), 800); };
const inboxFile = path.join(DATA, 'inbox.json'), blockFile = path.join(DATA, 'blocklist.json');
let inbox = loadJson(inboxFile, {}), blocklist = loadJson(blockFile, {});
const STOPW = /^(STOP|STOPP|ARRET|ARRÊT|DESABONNER|DÉSABONNER|DESINSCRIRE|UNSUBSCRIBE)\b/i;
function addInbound(list) {
  let added = 0;
  list.forEach(m => {
    if (!m.messageId || inbox[m.messageId]) return;
    inbox[m.messageId] = { ...m, receivedLocal: Date.now() };
    const t = String(m.cleanText || m.text || '').trim();
    if (m.from && STOPW.test(t) && !blocklist[m.from]) {
      blocklist[m.from] = { num: m.from, reason: 'A répondu « ' + t.split(/\s/)[0].toUpperCase() + ' »', at: new Date().toISOString(), source: 'auto' };
      added++;
    }
  });
  saveJson(inboxFile, inbox); if (added) saveJson(blockFile, blocklist);
  return added;
}

const STATIC = { '/logo-mark.svg': 'image/svg+xml', '/brand/logo.svg': 'image/svg+xml', '/brand/logo-blanc.svg': 'image/svg+xml', '/brand/logo-mark.svg': 'image/svg+xml' };
const ALLOWED = [/^\/sms\//, /^\/account\/1\/balance/, /^\/number\/1\/query/];
const json = (res, code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };
const readBody = req => new Promise(r => { let b = ''; req.on('data', c => { b += c; if (b.length > 5e6) req.destroy(); }); req.on('end', () => r(b)); });

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');

  // Webhook Infobip : protégé par le jeton, pas par le mot de passe
  if (url.pathname === '/webhook/dlr') {
    if (url.searchParams.get('token') !== TOKEN) return json(res, 403, { error: 'jeton invalide' });
    if (req.method !== 'POST') return json(res, 200, { ok: true });
    try {
      const data = JSON.parse(await readBody(req) || '{}');
      (data.results || []).forEach(m => { if (m.messageId) reports[m.messageId] = { ...m, receivedAt: Date.now() }; });
      saveReports();
      return json(res, 200, { ok: true, received: (data.results || []).length });
    } catch (e) { return json(res, 400, { error: 'JSON invalide' }); }
  }

  // Webhook Infobip pour les SMS reçus
  if (url.pathname === '/webhook/inbound') {
    if (url.searchParams.get('token') !== TOKEN) return json(res, 403, { error: 'jeton invalide' });
    if (req.method !== 'POST') return json(res, 200, { ok: true });
    try { const data = JSON.parse(await readBody(req) || '{}'); addInbound(data.results || []); return json(res, 200, { ok: true }); }
    catch (e) { return json(res, 400, { error: 'JSON invalide' }); }
  }

  // Authentification basique pour tout le reste
  if (PASS) {
    const [u, p] = Buffer.from((req.headers.authorization || '').replace(/^Basic /, ''), 'base64').toString().split(':');
    if (u !== USER || p !== PASS) { res.writeHead(401, { 'WWW-Authenticate': 'Basic realm="Mbote SMS"' }); return res.end('Accès refusé'); }
  }

  // Informations du serveur pour le dashboard
  if (url.pathname === '/local/config') return json(res, 200, { webhook: !!NOTIFY_URL, notifyUrl: NOTIFY_URL, publicUrl: PUBLIC_URL, stored: Object.keys(reports).length });

  // SMS reçus : récupère les nouveaux chez Infobip puis renvoie l'historique
  if (url.pathname === '/local/inbox') {
    let error = '', blockedAdded = 0;
    try {
      const r = await fetch('https://' + BASE + '/sms/1/inbox/reports?limit=1000', { headers: { Authorization: 'App ' + KEY, Accept: 'application/json' } });
      const t = await r.text(); let j = {}; try { j = JSON.parse(t || '{}'); } catch (e) {}
      if (!r.ok) error = (j.requestError && j.requestError.serviceException && j.requestError.serviceException.text) || ('HTTP ' + r.status);
      else blockedAdded = addInbound(j.results || []);
    } catch (e) { error = e.message; }
    const results = Object.values(inbox).sort((a, b) => new Date(b.receivedAt) - new Date(a.receivedAt)).slice(0, 3000);
    return json(res, 200, { results, error, blockedAdded, inboundUrl: PUBLIC_URL ? PUBLIC_URL + '/webhook/inbound?token=' + TOKEN : '' });
  }

  // Liste d'exclusion partagée
  if (url.pathname === '/local/blocklist') {
    if (req.method === 'POST') {
      try {
        const d = JSON.parse(await readBody(req) || '{}');
        (d.add || []).forEach(i => { if (i.num) blocklist[i.num] = { num: i.num, reason: i.reason || '', at: new Date().toISOString(), source: 'manuel' }; });
        (d.remove || []).forEach(n => delete blocklist[n]);
        saveJson(blockFile, blocklist);
      } catch (e) { return json(res, 400, { error: 'JSON invalide' }); }
    }
    return json(res, 200, { items: Object.values(blocklist) });
  }

  // Accusés reçus par webhook, filtrés par bulkId
  if (url.pathname === '/local/reports') {
    const b = url.searchParams.get('bulkId');
    const results = Object.values(reports).filter(r => !b || r.bulkId === b);
    return json(res, 200, { results });
  }

  // Proxy vers Infobip
  if (url.pathname.startsWith('/api/')) {
    const target = req.url.slice(4);
    if (!ALLOWED.some(r => r.test(target))) return json(res, 403, { error: 'Endpoint non autorisé' });
    const body = await readBody(req);
    try {
      const r = await fetch('https://' + BASE + target, {
        method: req.method,
        headers: { Authorization: 'App ' + KEY, 'Content-Type': 'application/json', Accept: 'application/json' },
        body: ['GET', 'HEAD'].includes(req.method) ? undefined : body
      });
      res.writeHead(r.status, { 'Content-Type': 'application/json' });
      return res.end(await r.text());
    } catch (e) { return json(res, 502, { error: 'Infobip injoignable : ' + e.message }); }
  }

  // Fichiers statiques
  if (STATIC[url.pathname]) {
    const f = path.join(__dirname, url.pathname);
    if (fs.existsSync(f)) { res.writeHead(200, { 'Content-Type': STATIC[url.pathname] }); return fs.createReadStream(f).pipe(res); }
  }
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  fs.createReadStream(path.join(__dirname, 'index.html')).pipe(res);
}).listen(PORT, () => {
  console.log('Mbote SMS : http://localhost:' + PORT);
  console.log(NOTIFY_URL ? 'Suivi temps réel actif : ' + PUBLIC_URL + '/webhook/dlr' : 'Suivi temps réel inactif (définissez PUBLIC_URL une fois en ligne).');
});
