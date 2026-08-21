#!/usr/bin/env node
/* Minimal static server with SPA fallback, so /home, /game and /editor
   all resolve to index.html. No dependencies — just `node server.js`. */

const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const PORT = Number(process.env.PORT) || 5173;

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon'
};

function send(res, status, body, type) {
  res.writeHead(status, {
    'Content-Type': type || 'text/plain; charset=utf-8',
    'Cache-Control': 'no-cache'
  });
  res.end(body);
}

const server = http.createServer((req, res) => {
  const urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
  const filePath = path.join(ROOT, path.normalize(urlPath));

  // Never serve anything outside the project folder.
  if (!filePath.startsWith(ROOT)) return send(res, 403, 'Forbidden');

  fs.stat(filePath, (err, stat) => {
    if (!err && stat.isFile()) {
      const type = TYPES[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
      return fs.createReadStream(filePath).pipe(res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-cache' }));
    }
    // Anything else is a client-side route.
    fs.readFile(path.join(ROOT, 'index.html'), (readErr, html) => {
      if (readErr) return send(res, 500, 'index.html saknas');
      send(res, 200, html, TYPES['.html']);
    });
  });
});

server.listen(PORT, () => {
  console.log(`Speluppgift körs på http://localhost:${PORT}/home`);
});
