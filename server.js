const express = require('express');
const app = express();
app.use(express.json({ limit: '10mb' }));
app.use(express.text({ type: 'text/html' }));
app.use(express.text({ type: 'text/plain' }));
app.use(express.raw({ type: 'application/javascript', limit: '10mb' }));
app.use(express.raw({ type: 'text/css', limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

const tunnels = {};
let defaultTunnelId = null;

// CORS middleware
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, Accept');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// Root: redirect to default tunnel if connected, otherwise show landing page
app.get('/', (req, res) => {
  if (defaultTunnelId && tunnels[defaultTunnelId]) {
    return res.redirect(302, `/t/${defaultTunnelId}/`);
  }
  res.send(`<!DOCTYPE html><html><head><title>🔮 Astrology Relay</title>
<style>body{font-family:-apple-system,sans-serif;max-width:700px;margin:60px auto;padding:0 20px;color:#333}h1{font-size:1.8em}h1 span{font-size:1.5em}.status{background:#f8f9fa;border-radius:12px;padding:24px;margin:20px 0}code{background:#f0f0f0;padding:2px 6px;border-radius:4px;font-size:.9em}.hint{color:#888;font-size:.9em;margin-top:16px;line-height:1.6}.waiting{text-align:center;padding:40px 0}.waiting h2{color:#6b5b95;margin-bottom:8px}.pulse{animation:pulse 2s infinite}@keyframes pulse{0%,100%{opacity:1}50%{opacity:.5}}</style></head><body>
<h1><span>🔮</span> Astrology Relay Server</h1>
<div class="status">
<div class="waiting">
<h2 class="pulse">⏳ Waiting for Tunnel Connection...</h2>
<p>The local astrology engine needs to connect before the site is available.</p>
<p style="margin-top:16px">This usually happens automatically within a few seconds. <a href="#" onclick="location.reload();return false">Refresh</a></p>
</div>
</div>
<div class="hint"><strong>How it works:</strong><br>• A tunnel client connects this relay to the local astrology engine<br>• Once connected, this page will redirect to the astrology website<br>• Direct link when connected: <code>/t/myastro/</code></div>
</body></html>`);
});

// Register tunnel
app.post('/api/register', (req, res) => {
  const tunnelId = req.body?.tunnel_id || Math.random().toString(36).slice(2, 10);
  tunnels[tunnelId] = { name: req.body?.name || 'tunnel', requests: {}, responses: {}, lastPoll: Date.now() };
  if (req.body?.default || !defaultTunnelId) defaultTunnelId = tunnelId;
  const publicUrl = `${req.protocol}://${req.get('host')}/t/${tunnelId}`;
  console.log(`Registered tunnel: ${tunnelId} -> ${publicUrl} (default: ${tunnelId === defaultTunnelId})`);
  res.json({ tunnel_id: tunnelId, public_url: publicUrl, is_default: tunnelId === defaultTunnelId });
});

// Poll for requests
app.get('/api/poll/:tunnelId', (req, res) => {
  const tunnel = tunnels[req.params.tunnelId];
  if (!tunnel) return res.status(404).json({ error: 'Tunnel not found' });
  tunnel.lastPoll = Date.now();
  const pending = Object.values(tunnel.requests).filter(r => !r.claimed);
  if (pending.length > 0) { pending[0].claimed = true; return res.json(pending[0]); }
  res.json({});
});

// Post response
app.post('/api/respond/:tunnelId', (req, res) => {
  const tunnel = tunnels[req.params.tunnelId];
  if (!tunnel) return res.status(404).json({ error: 'Tunnel not found' });
  const requestId = req.body?.request_id;
  if (!requestId) return res.status(400).json({ error: 'Missing request_id' });
  tunnel.responses[requestId] = req.body;
  delete tunnel.requests[requestId];
  res.json({ ok: true });
});

// Health check
app.get('/api/health', (req, res) => res.json({ status: 'ok', tunnels: Object.keys(tunnels).length, default_tunnel: defaultTunnelId }));

// Tunnel endpoint - STRIP the /t/:tunnelId prefix before forwarding
app.all('/t/:tunnelId/*', async (req, res) => {
  const tunnel = tunnels[req.params.tunnelId];
  if (!tunnel) {
    return res.status(404).send(`<!DOCTYPE html><html><head><title>Tunnel Not Found</title><style>body{font-family:sans-serif;max-width:600px;margin:80px auto;padding:20px;color:#333}h1{color:#c0392b}code{background:#f0f0f0;padding:2px 6px;border-radius:4px}</style></head><body><h1>🔮 Tunnel Not Found</h1><p>Tunnel <code>${req.params.tunnelId}</code> is not registered.</p><p>Make sure the tunnel client is running locally and has registered this tunnel.</p></body></html>`);
  }
  const strippedPath = '/' + (req.params[0] || '');
  await handleTunnelRequest(tunnel, req.params.tunnelId, req, strippedPath);
});

// Catch tunnel root
app.all('/t/:tunnelId', (req, res) => {
  const tunnel = tunnels[req.params.tunnelId];
  if (!tunnel) return res.status(404).send('Tunnel not found');
  handleTunnelRequest(tunnel, req.params.tunnelId, req, '/');
});

// Catch-all: forward to default tunnel
app.all('*', async (req, res) => {
  if (!defaultTunnelId || !tunnels[defaultTunnelId]) {
    return res.status(404).send(`<!DOCTYPE html><html><head><title>No Tunnel</title><style>body{font-family:sans-serif;max-width:600px;margin:80px auto;padding:20px;color:#333}</style></head><body><h1>🔮 Astrology Relay</h1><p>No tunnel is active yet. Start the tunnel client to connect your local server.</p></body></html>`);
  }
  await handleTunnelRequest(tunnels[defaultTunnelId], defaultTunnelId, req, req.originalUrl);
});

async function handleTunnelRequest(tunnel, tunnelId, req, forwardPath) {
  const requestId = Math.random().toString(36).slice(2);
  let body = '';
  try {
    if (req.is('application/json')) body = typeof req.body === 'object' ? JSON.stringify(req.body) : String(req.body || '');
    else if (req.is('text/html') || req.is('text/plain')) body = typeof req.body === 'string' ? req.body : String(req.body || '');
    else if (req.is('application/javascript')) body = Buffer.isBuffer(req.body) ? req.body.toString('utf-8') : String(req.body || '');
    else if (req.is('text/css')) body = Buffer.isBuffer(req.body) ? req.body.toString('utf-8') : String(req.body || '');
    else if (req.is('application/x-www-form-urlencoded')) body = typeof req.body === 'string' ? req.body : JSON.stringify(req.body || {});
    else body = typeof req.body === 'string' ? req.body : (req.body ? JSON.stringify(req.body) : '');
  } catch(e) { body = ''; }
  
  const reqHeaders = {};
  for (const [key, value] of Object.entries(req.headers)) {
    if (!['host', 'connection', 'content-length', 'transfer-encoding'].includes(key)) {
      reqHeaders[key] = value;
    }
  }
  
  tunnel.requests[requestId] = { request_id: requestId, method: req.method, path: forwardPath, headers: reqHeaders, body: body };
  console.log(`[${tunnelId}] ${req.method} ${forwardPath} [${requestId}]`);
  
  const startTime = Date.now();
  while (Date.now() - startTime < 120000) {
    if (tunnel.responses[requestId]) {
      const resp = tunnel.responses[requestId];
      delete tunnel.responses[requestId];
      const skipHeaders = new Set(['transfer-encoding', 'connection', 'content-length', 'date', 'server', 'x-powered-by']);
      if (resp.headers) {
        for (const [k, v] of Object.entries(resp.headers)) {
          if (!skipHeaders.has(k.toLowerCase())) { try { res.set(k, String(v)); } catch(e) {} }
        }
      }
      return res.status(resp.status || 200).send(resp.body);
    }
    await new Promise(r => setTimeout(r, 50));
  }
  delete tunnel.requests[requestId];
  delete tunnel.responses[requestId];
  res.status(504).send('Tunnel timeout - the local server may be down');
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🔮 Astrology Relay Server on port ${PORT}`));