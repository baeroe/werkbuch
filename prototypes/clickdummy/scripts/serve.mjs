// A plain static server for the review build, the way an artifact host serves it, for the Playwright check
// (e2e/review.spec.ts):
//   - every file of the folder as it is, unknown paths answer 404 (no fallback to index.html)
//   - index.html is the fragment of scripts/artifact.mjs: it comes wrapped in a page skeleton, as the host wraps it
//   - /sandbox.html shows that page in <iframe sandbox="allow-scripts">: no origin of its own, so localStorage throws
//     and the files arrive cross-origin (hence the CORS header)
//
//   node scripts/serve.mjs [dir=dist-review] [port=5198]

import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';

const root = path.resolve(process.argv[2] ?? 'dist-review');
const port = Number(process.argv[3] ?? 5198);

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
};

const skeleton = (fragment) =>
  `<!doctype html>\n<html>\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n</head>\n<body>\n${fragment}</body>\n</html>\n`;

const SANDBOX = `<!doctype html>
<html lang="de">
<head><meta charset="utf-8"><title>Sandbox</title>
<style>html, body { margin: 0; height: 100%; } iframe { border: 0; width: 100%; height: 100%; display: block; }</style></head>
<body><iframe title="werkbuch Klickdummy" sandbox="allow-scripts" src="index.html"></iframe></body>
</html>
`;

const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? '/', `http://localhost:${port}`);
  const send = (status, body, type) => {
    response.writeHead(status, { 'Content-Type': type, 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store' });
    response.end(body);
  };
  try {
    if (url.pathname === '/sandbox.html') return send(200, SANDBOX, TYPES['.html']);
    const relative = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname);
    const file = path.resolve(root, `.${relative}`);
    if (!file.startsWith(`${root}${path.sep}`)) return send(403, 'forbidden', 'text/plain');
    const body = await readFile(file);
    if (relative === '/index.html') return send(200, skeleton(body.toString('utf8')), TYPES['.html']);
    return send(200, body, TYPES[path.extname(file)] ?? 'application/octet-stream');
  } catch {
    return send(404, 'not found', 'text/plain');
  }
});

server.listen(port, () => console.log(`serve: ${path.relative(process.cwd(), root) || '.'} on http://localhost:${port}`));
