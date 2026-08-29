#!/usr/bin/env node
/*
 * Local preview server.  node tools/serve.js  ->  http://localhost:8099
 *
 * WebHID needs a secure context; http://localhost counts as one, so the
 * keyboard can actually be configured from here for testing.
 */
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');

const root = path.resolve(__dirname, '..');
const port = Number(process.env.PORT) || 8099;

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.zip': 'application/zip',
  '.exe': 'application/octet-stream'
};

http
  .createServer((req, res) => {
    let pathname;
    try {
      pathname = decodeURIComponent(url.parse(req.url).pathname);
    } catch (e) {
      res.writeHead(400).end('bad request');
      return;
    }
    if (pathname === '/') pathname = '/index.html';

    const file = path.join(root, pathname);
    // refuse to serve outside the mirror
    if (!file.startsWith(root)) {
      res.writeHead(403).end('forbidden');
      return;
    }

    fs.readFile(file, (err, data) => {
      if (err) {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('404 ' + pathname);
        return;
      }
      res.writeHead(200, {
        'Content-Type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream',
        'Cache-Control': 'no-store'
      });
      res.end(data);
    });
  })
  .listen(port, () => {
    process.stdout.write('serving ' + root + '\n');
    process.stdout.write('http://localhost:' + port + '\n');
  });
