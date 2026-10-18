const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.pdf': 'application/pdf',
};

function createFrontend(directory) {
  const root = fs.realpathSync(directory);
  return http.createServer(async (req, res) => {
    if (!['GET', 'HEAD'].includes(req.method)) {
      res.writeHead(405);
      return res.end();
    }
    try {
      const pathname = decodeURIComponent(req.url.split('?')[0]);
      const relative = pathname.replace(/^[/\\]+/, '') || 'index.html';
      if (
        relative.split(/[/\\]/).some((part) => part.startsWith('.')) ||
        relative.includes(':')
      ) {
        res.writeHead(403);
        return res.end();
      }
      const file = await fs.promises.realpath(path.resolve(root, relative));
      if (
        !file.startsWith(root + path.sep) ||
        !(await fs.promises.stat(file)).isFile()
      ) {
        res.writeHead(403);
        return res.end();
      }
      const content = await fs.promises.readFile(file);
      res.writeHead(200, {
        'Content-Type': types[path.extname(file)] || 'application/octet-stream',
        'Content-Length': content.length,
        'Cache-Control': 'no-store',
      });
      res.end(req.method === 'HEAD' ? undefined : content);
    } catch (error) {
      res.writeHead(
        error instanceof URIError ? 400 : error.code === 'ENOENT' ? 404 : 500,
      );
      res.end();
    }
  });
}

module.exports = { createFrontend };
