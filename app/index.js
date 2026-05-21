'use strict';

const http = require('http');
const os = require('os');
const client = require('prom-client');

const PORT = parseInt(process.env.PORT || '3000', 10);
const VERSION = process.env.APP_VERSION || 'unknown';
const SLOT = process.env.DEPLOY_SLOT || 'stable';
const FAIL_RATE = Math.max(0, Math.min(100, parseInt(process.env.FAIL_RATE || '0', 10)));
const HOSTNAME = os.hostname();

const register = new client.Registry();
register.setDefaultLabels({ app: 'canary-tutorial-app' });
client.collectDefaultMetrics({ register });

const httpRequestsTotal = new client.Counter({
  name: 'http_requests_total',
  help: 'Total number of HTTP requests by status code and path',
  labelNames: ['status', 'path'],
  registers: [register],
});

const httpRequestDuration = new client.Histogram({
  name: 'http_request_duration_seconds',
  help: 'HTTP request duration in seconds, observed at response time',
  labelNames: ['status', 'path'],
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
  registers: [register],
});

function shouldFail() {
  return FAIL_RATE > 0 && Math.random() * 100 < FAIL_RATE;
}

function renderPage() {
  const shortVersion = VERSION.length > 12 ? VERSION.slice(0, 7) : VERSION;
  const timestamp = new Date().toISOString();
  const slotColor =
    SLOT === 'canary' ? '#f59e0b' :
    SLOT === 'stable' ? '#10b981' :
    '#06b6d4';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Canary Deployment Demo</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #0f1117;
      color: #fff;
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
    }
    .card {
      background: #1a1d27;
      border: 1px solid #2a2d3e;
      border-radius: 16px;
      padding: 52px 48px;
      width: 100%;
      max-width: 500px;
      margin: 24px;
      text-align: center;
    }
    .badge {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      background: rgba(245, 158, 11, 0.08);
      border: 1px solid rgba(245, 158, 11, 0.25);
      border-radius: 100px;
      padding: 6px 18px;
      font-size: 12px;
      font-weight: 600;
      color: #f59e0b;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      margin-bottom: 28px;
    }
    .dot {
      width: 7px;
      height: 7px;
      background: #f59e0b;
      border-radius: 50%;
      animation: pulse 2s ease-in-out infinite;
    }
    @keyframes pulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.35; }
    }
    h1 {
      font-size: 26px;
      font-weight: 700;
      letter-spacing: -0.02em;
      margin-bottom: 6px;
    }
    .subtitle {
      font-size: 13px;
      color: #6b7080;
      margin-bottom: 40px;
      letter-spacing: 0.04em;
    }
    .meta {
      display: flex;
      flex-direction: column;
      gap: 10px;
      text-align: left;
    }
    .row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      background: #12141d;
      border: 1px solid #1e2130;
      border-radius: 8px;
      padding: 13px 16px;
    }
    .label {
      font-size: 12px;
      font-weight: 500;
      color: #6b7080;
      text-transform: uppercase;
      letter-spacing: 0.06em;
    }
    .value {
      font-family: 'SF Mono', 'Fira Code', 'Fira Mono', monospace;
      font-size: 12px;
      color: #c8cde0;
    }
    .slot-indicator {
      display: inline-block;
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: ${slotColor};
      margin-right: 6px;
      vertical-align: middle;
    }
    .footer {
      margin-top: 36px;
      font-size: 11px;
      color: #3a3d52;
    }
    .footer a {
      color: #4a5080;
      text-decoration: none;
    }
  </style>
</head>
<body>
  <div class="card">
    <div class="badge">
      <span class="dot"></span>
      Deployment Successful
    </div>
    <h1>Canary Deployment Demo</h1>
    <p class="subtitle">Kubernetes &nbsp;&middot;&nbsp; CircleCI &nbsp;&middot;&nbsp; Argo Rollouts</p>
    <div class="meta">
      <div class="row">
        <span class="label">Version</span>
        <span class="value">${shortVersion}</span>
      </div>
      <div class="row">
        <span class="label">Slot</span>
        <span class="value"><span class="slot-indicator"></span>${SLOT}</span>
      </div>
      <div class="row">
        <span class="label">Pod</span>
        <span class="value">${HOSTNAME}</span>
      </div>
      <div class="row">
        <span class="label">Timestamp</span>
        <span class="value">${timestamp}</span>
      </div>
    </div>
    <p class="footer">
      <a href="https://github.com/CIRCLECI-GWP/kubernetes-canary-deployment-circleci">
        CIRCLECI-GWP/kubernetes-canary-deployment-circleci
      </a>
    </p>
  </div>
</body>
</html>`;
}

const server = http.createServer((req, res) => {
  const start = process.hrtime.bigint();
  const url = req.url || '/';
  const path = url.split('?')[0];

  const finish = (status) => {
    const elapsed = Number(process.hrtime.bigint() - start) / 1e9;
    httpRequestsTotal.labels(String(status), path).inc();
    httpRequestDuration.labels(String(status), path).observe(elapsed);
  };

  if (path === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok' }));
    finish(200);
    return;
  }

  if (path === '/metrics') {
    res.setHeader('Content-Type', register.contentType);
    register.metrics().then((metrics) => {
      res.writeHead(200);
      res.end(metrics);
      finish(200);
    });
    return;
  }

  if (path === '/' || path === '/api') {
    if (shouldFail()) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'injected failure' }));
      finish(500);
      return;
    }

    if (path === '/api') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        version: VERSION,
        slot: SLOT,
        hostname: HOSTNAME,
        timestamp: new Date().toISOString(),
      }));
      finish(200);
      return;
    }

    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(renderPage());
    finish(200);
    return;
  }

  res.writeHead(404);
  res.end();
  finish(404);
});

server.listen(PORT, () => {
  console.log(`canary-tutorial-app v${VERSION} slot=${SLOT} fail_rate=${FAIL_RATE}% listening on :${PORT}`);
});

function shutdown(signal) {
  console.log(`Received ${signal}, shutting down`);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 10000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
