const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');

const root = __dirname;
const port = Number(process.env.PORT || 4173);
const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.json': 'application/json; charset=utf-8' };
const allowed = new Set(['index.html', 'css/style.css', 'js/data.js', 'js/ui.js', 'js/app.js', 'assets/guild-map.svg']);

http.createServer(async (request, response) => {
  try {
    if (!['GET', 'HEAD'].includes(request.method)) {
      response.writeHead(405, { Allow: 'GET, HEAD' }).end();
      return;
    }
    const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    const file = pathname === '/' ? 'index.html' : pathname.slice(1);
    if (!allowed.has(file)) {
      response.writeHead(404).end('Not found');
      return;
    }
    const content = await fs.readFile(path.join(root, file));
    response.writeHead(200, { 'Content-Type': types[path.extname(file)], 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff' });
    response.end(request.method === 'HEAD' ? undefined : content);
  } catch {
    response.writeHead(400).end('Bad request');
  }
}).listen(port, '127.0.0.1', () => {
  console.log(`酱菜冒险者公会已开启：http://localhost:${port}`);
  console.log('这是本地静态页面服务，不是共享数据后端。按 Ctrl+C 停止。');
});
