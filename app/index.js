const http = require('http');
const os = require('os');
const client = require('prom-client');

const PORT = parseInt(process.env.PORT || '3000', 10);
const APP_VERSION = process.env.APP_VERSION || 'unknown';
const DEPLOY_SLOT = process.env.DEPLOY_SLOT || 'stable';
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

function htmlPage(payload) {
  const slotColor = DEPLOY_SLOT === 'canary' ? '#ff9f1c' : '#2ec4b6';
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Canary tutorial app</title>
<style>
  body { font-family: -apple-system, system-ui, sans-serif; margin: 0; padding: 2rem; background: #011627; color: #fdfffc; }
  .card { max-width: 540px; margin: 4rem auto; background: #1a2433; border-radius: 12px; padding: 2rem; box-shadow: 0 8px 32px rgba(0,0,0,0.3); }
  h1 { margin-top: 0; }
  .slot { display: inline-block; padding: 0.25rem 0.75rem; border-radius: 999px; background: ${slotColor}; color: #011627; font-weight: 600; }
  dl { display: grid; grid-template-columns: max-content 1fr; gap: 0.5rem 1rem; }
  dt { color: #9aa5b1; }
  dd { margin: 0; font-family: ui-monospace, SFMono-Regular, monospace; }
</style>
</head>
<body>
  <div class="card">
    <h1>Canary tutorial app</h1>
    <p>Slot: <span class="slot">${payload.slot}</span></p>
    <dl>
      <dt>Version</dt><dd>${payload.version}</dd>
      <dt>Hostname</dt><dd>${payload.hostname}</dd>
      <dt>Timestamp</dt><dd>${payload.timestamp}</dd>
    </dl>
  </div>
</body>
</html>`;
}

const server = http.createServer((req, res) => {
  const start = process.hrtime.bigint();
  const url = req.url || '/';
  const path = url.split('?')[0];

  let status = 200;
  let body = '';
  let contentType = 'text/plain; charset=utf-8';

  try {
    if (path === '/health') {
      body = JSON.stringify({ status: 'ok' });
      contentType = 'application/json';
    } else if (path === '/metrics') {
      res.setHeader('Content-Type', register.contentType);
      register.metrics().then((metrics) => {
        res.writeHead(200);
        res.end(metrics);
        const elapsed = Number(process.hrtime.bigint() - start) / 1e9;
        httpRequestsTotal.labels('200', '/metrics').inc();
        httpRequestDuration.labels('200', '/metrics').observe(elapsed);
      });
      return;
    } else if (path === '/api' || path === '/') {
      if (shouldFail()) {
        status = 500;
        body = path === '/api'
          ? JSON.stringify({ error: 'injected failure' })
          : 'Internal Server Error';
        contentType = path === '/api' ? 'application/json' : 'text/plain';
      } else {
        const payload = {
          version: APP_VERSION,
          slot: DEPLOY_SLOT,
          hostname: HOSTNAME,
          timestamp: new Date().toISOString(),
        };
        if (path === '/api') {
          body = JSON.stringify(payload);
          contentType = 'application/json';
        } else {
          body = htmlPage(payload);
          contentType = 'text/html; charset=utf-8';
        }
      }
    } else {
      status = 404;
      body = 'Not Found';
    }
  } catch (err) {
    status = 500;
    body = 'Internal Server Error';
  }

  res.writeHead(status, { 'Content-Type': contentType });
  res.end(body);

  const elapsed = Number(process.hrtime.bigint() - start) / 1e9;
  httpRequestsTotal.labels(String(status), path).inc();
  httpRequestDuration.labels(String(status), path).observe(elapsed);
});

server.listen(PORT, () => {
  console.log(`canary-tutorial-app v${APP_VERSION} slot=${DEPLOY_SLOT} fail_rate=${FAIL_RATE}% listening on :${PORT}`);
});

function shutdown(signal) {
  console.log(`Received ${signal}, shutting down`);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 10000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
