const express = require('express');
const app = express();
app.use(express.json({ limit: '10mb' }));
app.use(express.text({ type: 'text/html' }));
app.use(express.raw({ type: 'application/javascript', limit: '10mb' }));
app.use(express.raw({ type: 'text/css', limit: '10mb' }));

const tunnels = {};

// Register a new tunnel
app.post('/api/register', (req, res) => {
  const tunnelId = req.body?.tunnel_id || Math.random().toString(36).slice(2, 10);
  tunnels[tunnelId] = {
    name: req.body?.name || 'tunnel',
    requests: {},
    responses: {},
    lastPoll: Date.now()
  };
  const publicUrl = `${req.protocol}://${req.get('host')}/t/${tunnelId}`;
  console.log(`Registered tunnel: ${tunnelId} -> ${publicUrl}`);
  res.json({ tunnel_id: tunnelId, public_url: publicUrl });
});

// Tunnel client polls for incoming requests
app.get('/api/poll/:tunnelId', (req, res) => {
  const tunnel = tunnels[req.params.tunnelId];
  if (!tunnel) return res.status(404).json({ error: 'Tunnel not found' });
  
  tunnel.lastPoll = Date.now();
  const pending = Object.values(tunnel.requests).filter(r => !r.claimed);
  if (pending.length > 0) {
    pending[0].claimed = true;
    return res.json(pending[0]);
  }
  res.json({});
});

// Tunnel client posts responses
app.post('/api/respond/:tunnelId', (req, res) => {
  const tunnel = tunnels[req.params.tunnelId];
  if (!tunnel) return res.status(404).json({ error: 'Tunnel not found' });
  tunnel.responses[req.body.request_id] = req.body;
  delete tunnel.requests[req.body.request_id];
  res.json({ ok: true });
});

// Health check
app.get('/api/health', (req, res) => res.json({ status: 'ok', tunnels: Object.keys(tunnels).length }));

// Public endpoint - receives requests and waits for tunnel response
app.all('/t/:tunnelId/*', async (req, res) => {
  const tunnel = tunnels[req.params.tunnelId];
  if (!tunnel) return res.status(404).send('Tunnel not found - is the local server running?');
  
  const requestId = Math.random().toString(36).slice(2);
  const path = '/' + (req.params[0] || '');
  
  // Get body
  let body = '';
  if (req.is('application/json')) {
    body = JSON.stringify(req.body);
  } else if (req.is('text/plain') || req.is('text/html')) {
    body = req.body;
  } else if (req.is('application/x-www-form-urlencoded')) {
    body = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
  } else {
    body = typeof req.body === 'string' ? req.body : (req.body ? JSON.stringify(req.body) : '');
  }
  
  // Queue the request
  tunnel.requests[requestId] = {
    request_id: requestId,
    method: req.method,
    path: path,
    headers: {
      'content-type': req.get('content-type') || 'application/json',
      'accept': req.get('accept') || '*/*',
    },
    body: body
  };
  
  console.log(`Request ${req.method} ${path} -> tunnel ${req.params.tunnelId}`);
  
  // Wait for response (up to 60 seconds)
  const startTime = Date.now();
  while (Date.now() - startTime < 60000) {
    if (tunnel.responses[requestId]) {
      const resp = tunnel.responses[requestId];
      delete tunnel.responses[requestId];
      
      // Set response headers
      const skipHeaders = ['transfer-encoding', 'connection', 'content-length', 'date', 'server'];
      for (const [k, v] of Object.entries(resp.headers || {})) {
        if (!skipHeaders.includes(k.toLowerCase())) {
          try { res.set(k, v); } catch(e) {}
        }
      }
      return res.status(resp.status).send(resp.body);
    }
    await new Promise(r => setTimeout(r, 50));
  }
  res.status(504).send('Tunnel timeout - the local server may be down');
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🔮 Astrology Relay Server on port ${PORT}`));