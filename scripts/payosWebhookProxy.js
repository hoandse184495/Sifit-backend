// Expose only the signed PayOS webhook through a local tunnel, never the admin/API surface.
const http = require('http');
const env = require('../src/config/env');
const path = '/api/v1/webhooks/payments/payos';
const port = Number(process.env.PAYOS_PROXY_PORT || 5001);
if (port === env.PORT) throw new Error('PayOS proxy and backend must use different ports');
http
  .createServer((req, res) => {
    if (req.method !== 'POST' || req.url !== path) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > 65536) {
        res.writeHead(413);
        res.end();
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      const body = Buffer.concat(chunks);
      const upstream = http.request(
        {
          hostname: '127.0.0.1',
          port: env.PORT,
          method: 'POST',
          path,
          timeout: 20000,
          headers: { 'content-type': 'application/json', 'content-length': body.length },
        },
        (response) => {
          res.writeHead(response.statusCode, { 'content-type': 'application/json' });
          response.pipe(res);
        },
      );
      upstream.on('error', () => {
        if (!res.headersSent) res.writeHead(502);
        res.end('Backend unavailable');
      });
      upstream.on('timeout', () => upstream.destroy());
      upstream.end(body);
    });
  })
  .listen(port, '127.0.0.1', () =>
    console.log(`PayOS webhook-only proxy: http://127.0.0.1:${port}${path}`),
  );
