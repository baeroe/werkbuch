// Smoke test of a running compose stack (scripts/compose-smoke.sh starts it): sign-in, live updates over the one port,
// search, the limits of nginx and what only the image changes (cached routes, no Reverb HTTP API, no HSTS).
// Node 24, no dependencies. As a script it reads SMOKE_URL, SMOKE_EMAIL, SMOKE_PASSWORD, SMOKE_PROBE and SMOKE_MODE
// (full | again), writes `smoke: <check> ok` per check and `smoke: ok` at the end, or the failure and exit code 1.
import http from 'node:http';
import { pathToFileURL } from 'node:url';
import zlib from 'node:zlib';

/** The cookies of one browser: what Set-Cookie headers set, sent back as one Cookie header. */
export class CookieJar {
  #cookies = new Map();

  /** @param {string[]} setCookieHeaders */
  store(setCookieHeaders) {
    for (const line of setCookieHeaders) {
      const [pair, ...attributes] = line.split(';');
      const at = pair.indexOf('=');
      if (at < 1) {
        continue;
      }
      const name = pair.slice(0, at).trim();
      const value = pair.slice(at + 1).trim();
      const expired = attributes.some((attribute) => {
        const [key, raw = ''] = attribute.split('=');
        const option = key.trim().toLowerCase();
        if (option === 'max-age') {
          return Number(raw.trim()) <= 0;
        }
        if (option === 'expires') {
          return Date.parse(raw.trim()) <= Date.now();
        }
        return false;
      });

      if (expired) {
        this.#cookies.delete(name);
      } else {
        this.#cookies.set(name, value);
      }
    }
  }

  /** @returns {string} */
  header() {
    return [...this.#cookies].map(([name, value]) => `${name}=${value}`).join('; ');
  }

  /** @returns {string | null} */
  get(name) {
    return this.#cookies.get(name) ?? null;
  }
}

/** The CSRF token Laravel wants back in X-XSRF-TOKEN: the cookie, URL-decoded. */
export function xsrfToken(jar) {
  const value = jar.get('XSRF-TOKEN');
  if (value === null) {
    throw new Error('no XSRF-TOKEN cookie');
  }
  return decodeURIComponent(value);
}

function decodeEntities(text) {
  const named = { amp: '&', quot: '"', lt: '<', gt: '>', apos: "'" };
  return text.replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z]+);/gi, (entity, code) => {
    if (code[0] === '#') {
      const number = code[1] === 'x' || code[1] === 'X' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return String.fromCodePoint(number);
    }
    return named[code.toLowerCase()] ?? entity;
  });
}

/** The Inertia page of an HTML answer: `<script data-page="app" type="application/json">` or a `data-page` attribute. */
export function inertiaPage(html) {
  const script = html.match(/<script\b[^>]*\bdata-page="app"[^>]*>([\s\S]*?)<\/script>/i);
  if (script) {
    return JSON.parse(script[1]);
  }
  const attribute = html.match(/\bdata-page="([^"]*)"/i);
  if (attribute) {
    return JSON.parse(decodeEntities(attribute[1]));
  }
  throw new Error('no Inertia page in the answer');
}

/** A Pusher frame of Reverb; its data comes as JSON text and is unpacked. */
export function liveFrame(text) {
  const frame = JSON.parse(text);
  let data = frame.data ?? null;
  if (typeof data === 'string') {
    try {
      data = JSON.parse(data);
    } catch {
      // plain text stays text
    }
  }
  const result = { event: frame.event, data };
  if (frame.channel !== undefined) {
    result.channel = frame.channel;
  }
  return result;
}

/** A PNG of width × height pixels, RGB, black. */
function png(width, height) {
  const chunk = (type, data) => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(zlib.crc32(body));
    return Buffer.concat([length, body, crc]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 2, 0, 0, 0], 8);
  const rows = Buffer.alloc(height * (1 + width * 3));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', zlib.deflateSync(rows)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function check(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

/** Asks until `answer` returns something other than undefined, at most `ms`; the last error or answer explains a timeout. */
async function until(what, ms, answer) {
  const end = Date.now() + ms;
  let last = 'no answer';
  for (;;) {
    try {
      const value = await answer();
      if (value !== undefined) {
        return value;
      }
      last = 'not yet';
    } catch (error) {
      last = error instanceof Error ? error.message : String(error);
    }
    if (Date.now() >= end) {
      throw new Error(`${what}: not within ${ms / 1000} s (${last})`);
    }
    await pause(1000);
  }
}

/** A browser session against the stack: cookies, Origin and Referer, the CSRF token on writes. */
class Session {
  jar = new CookieJar();

  constructor(base) {
    this.base = base;
  }

  async request(method, path, { json, body, headers = {} } = {}) {
    const all = { Origin: this.base.origin, Referer: `${this.base.origin}/`, Accept: 'application/json', ...headers };
    const cookies = this.jar.header();
    if (cookies !== '') {
      all.Cookie = cookies;
    }
    if (method !== 'GET' && method !== 'HEAD' && this.jar.get('XSRF-TOKEN') !== null) {
      all['X-XSRF-TOKEN'] = xsrfToken(this.jar);
    }
    if (json !== undefined) {
      all['Content-Type'] = 'application/json';
      body = JSON.stringify(json);
    }
    const response = await fetch(new URL(path, this.base), { method, headers: all, body, redirect: 'manual' });
    this.jar.store(response.headers.getSetCookie());
    const text = await response.text();
    return { status: response.status, headers: response.headers, text };
  }

  async json(method, path, options) {
    const answer = await this.request(method, path, options);
    let data = null;
    try {
      data = JSON.parse(answer.text);
    } catch {
      // not JSON: data stays null, the status tells
    }
    return { ...answer, data };
  }
}

function expectStatus(answer, status, what) {
  const allowed = Array.isArray(status) ? status : [status];
  check(allowed.includes(answer.status), `${what}: status ${answer.status}, expected ${allowed.join(' or ')}: ${answer.text.slice(0, 300)}`);
}

/** A WebSocket to Reverb through nginx with the Origin of the app; frames wait in a queue for `next`. */
class Live {
  frames = [];
  waiters = [];

  static async open(url, origin) {
    const live = new Live();
    // undici (Node 24) takes headers in the second argument and sends Origin; Reverb refuses a connection without it
    live.socket = new WebSocket(url, { headers: { Origin: origin } });
    live.socket.addEventListener('message', (message) => live.#receive(liveFrame(String(message.data))));
    live.socket.addEventListener('error', () => live.#receive({ event: 'socket:error', data: null }));
    live.socket.addEventListener('close', (event) => live.#receive({ event: 'socket:close', data: { code: event.code } }));
    return live;
  }

  #receive(frame) {
    if (frame.event === 'pusher:ping') {
      this.send({ event: 'pusher:pong', data: {} });
      return;
    }
    this.frames.push(frame);
    for (const waiter of [...this.waiters]) {
      waiter();
    }
  }

  send(frame) {
    this.socket.send(JSON.stringify(frame));
  }

  /** The first frame (also an earlier one) that `matches`; a closed socket or the timeout fail. */
  next(what, ms, matches) {
    return new Promise((resolve, reject) => {
      const look = () => {
        const index = this.frames.findIndex(matches);
        if (index >= 0) {
          finish();
          resolve(this.frames.splice(index, 1)[0]);
          return;
        }
        const closed = this.frames.find((frame) => frame.event === 'socket:close' || frame.event === 'socket:error');
        if (closed) {
          finish();
          reject(new Error(`${what}: the WebSocket ended (${JSON.stringify(closed.data)}), frames ${JSON.stringify(this.frames)}`));
        }
      };
      const timer = setTimeout(() => {
        finish();
        reject(new Error(`${what}: not within ${ms / 1000} s, frames ${JSON.stringify(this.frames)}`));
      }, ms);
      const finish = () => {
        clearTimeout(timer);
        this.waiters = this.waiters.filter((waiter) => waiter !== look);
      };
      this.waiters.push(look);
      look();
    });
  }

  close() {
    this.socket.close();
  }
}

/** A request whose Content-Length is too large and whose body never comes: only nginx can answer it. */
function oversized(base, path, length) {
  return new Promise((resolve, reject) => {
    const request = http.request(new URL(path, base), {
      method: 'POST',
      headers: { 'Content-Length': String(length), 'Content-Type': 'application/octet-stream', Origin: base.origin },
    });
    request.on('response', (response) => {
      response.resume();
      resolve(response.statusCode);
      request.destroy();
    });
    request.on('error', reject);
    request.setTimeout(15_000, () => request.destroy(new Error('no answer within 15 s')));
    request.flushHeaders();
  });
}

function randomIdentifier() {
  const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  return `S${Array.from({ length: 5 }, () => letters[Math.floor(Math.random() * letters.length)]).join('')}`;
}

/** @param {Record<string, string | undefined>} env */
export async function run(env, log = (line) => console.log(line)) {
  const base = new URL(env.SMOKE_URL || 'http://localhost:7740');
  const mode = env.SMOKE_MODE || 'full';
  const email = env.SMOKE_EMAIL ?? '';
  const password = env.SMOKE_PASSWORD ?? '';
  const probe = env.SMOKE_PROBE ?? '';
  check(['full', 'again'].includes(mode), `SMOKE_MODE must be full or again, not ${mode}`);
  check(email !== '' && password !== '', 'SMOKE_EMAIL and SMOKE_PASSWORD are required');
  check(/^[a-z]{8,16}$/.test(probe), 'SMOKE_PROBE must be 8 to 16 lowercase letters');

  const session = new Session(base);
  const ok = (name) => log(`smoke: ${name} ok`);

  // (a) the stack answers (a fresh first start migrates and imports first)
  await until('GET /up', 180_000, async () => ((await session.request('GET', `/up?probe=${probe}`)).status === 200 ? true : undefined));
  ok('up');

  if (mode === 'full') {
    // (b) the reset page: its token is masked in the access log (compose-smoke.sh looks)
    expectStatus(await session.request('GET', `/reset-password/${probe}?email=probe%40example.com`, { headers: { Accept: 'text/html' } }), 200, 'reset page');
    ok('reset page');

    // (c) the OpenAPI document from scramble:cache
    const openapi = await session.json('GET', '/api/openapi.json');
    expectStatus(openapi, 200, 'GET /api/openapi.json');
    check(typeof openapi.data?.openapi === 'string' && openapi.data.openapi.startsWith('3.1'), `openapi is ${openapi.data?.openapi}`);
    ok('openapi');

    // (d) MCP without a token
    expectStatus(
      await session.request('POST', '/mcp', { json: { jsonrpc: '2.0', id: 1, method: 'tools/list' }, headers: { Accept: 'application/json, text/event-stream' } }),
      401,
      'POST /mcp without a token',
    );
    ok('mcp');
  }

  // (e) sign in like the SPA: CSRF cookie, then the session
  expectStatus(await session.request('GET', '/sanctum/csrf-cookie'), 204, 'GET /sanctum/csrf-cookie');
  const login = await session.request('POST', '/login', { json: { email, password } });
  check(login.status >= 200 && login.status < 300, `POST /login: status ${login.status}: ${login.text.slice(0, 300)}`);
  const me = await session.json('GET', '/api/v1/me');
  expectStatus(me, 200, 'GET /api/v1/me');
  check(me.data?.data?.email === email, `me is ${me.data?.data?.email}, not ${email}`);
  check(me.data?.data?.org_role === 'admin', `org_role is ${me.data?.data?.org_role}`);
  ok('sign-in');

  // (f) the default bot of the migrations
  const bots = await session.json('GET', '/api/v1/bots');
  expectStatus(bots, 200, 'GET /api/v1/bots');
  check((bots.data?.data ?? []).some((bot) => bot.handle === 'automation'), 'no bot automation');
  ok('bots');

  if (mode === 'again') {
    const people = await session.json('GET', '/api/v1/users?filter[type]=person');
    expectStatus(people, 200, 'GET /api/v1/users');
    check(people.data?.meta?.total === 1, `${people.data?.meta?.total} people, expected exactly the one admin`);
    ok('one person');
    log('smoke: ok');
    return;
  }

  // (g) the browser's live address is APP_URL (never reverb:6001)
  const page = await session.request('GET', '/my-items', { headers: { Accept: 'text/html' } });
  expectStatus(page, 200, 'GET /my-items');
  const live = inertiaPage(page.text).props?.features?.live;
  const port = Number(base.port || (base.protocol === 'https:' ? 443 : 80));
  check(typeof live?.key === 'string' && live.key !== '', `features.live has no key: ${JSON.stringify(live)}`);
  check(live.host === base.hostname && live.port === port && live.scheme === base.protocol.slice(0, -1), `features.live is ${JSON.stringify(live)}`);
  ok('live address');

  // (h) the WebSocket through nginx on the one port
  const wsScheme = base.protocol === 'https:' ? 'wss' : 'ws';
  const socket = await Live.open(`${wsScheme}://${base.host}/app/${live.key}?protocol=7&client=js&version=8.6.0&flash=false`, base.origin);
  let projectId = null;
  try {
    const established = await socket.next('pusher:connection_established', 15_000, (frame) => frame.event === 'pusher:connection_established');
    const socketId = established.data?.socket_id;
    check(typeof socketId === 'string' && socketId !== '', `no socket_id: ${JSON.stringify(established)}`);
    ok('websocket');

    // (i) a project, (i2) found by its identifier with the cached routes
    const identifier = randomIdentifier();
    const created = await session.json('POST', '/api/v1/projects', { json: { name: `Smoke ${probe}`, identifier } });
    expectStatus(created, 201, 'POST /api/v1/projects');
    projectId = created.data.data.id;
    ok('project');
    const byIdentifier = await session.json('GET', `/api/v1/projects/${identifier}`);
    expectStatus(byIdentifier, 200, `GET /api/v1/projects/${identifier}`);
    check(byIdentifier.data?.data?.id === projectId, `project by identifier is ${byIdentifier.data?.data?.id}`);
    ok('project by identifier');

    // (j) the project's channel, signed by the batch route
    const channel = `private-project.${projectId}`;
    const batch = await session.json('POST', '/broadcasting/batch', { json: { socket_id: socketId, channel_names: [channel] } });
    expectStatus(batch, 200, 'POST /broadcasting/batch');
    const auth = batch.data?.channels?.[channel]?.auth;
    check(typeof auth === 'string', `no auth for ${channel}: ${batch.text.slice(0, 300)}`);
    socket.send({ event: 'pusher:subscribe', data: { auth, channel } });
    await socket.next('subscription', 15_000, (frame) => frame.event === 'pusher_internal:subscription_succeeded' && frame.channel === channel);
    ok('channel');

    // (k) an item: outbox → queue live → Reverb at reverb:6001 → WebSocket over nginx (no X-Socket-ID: we hear it)
    const item = await session.json('POST', '/api/v1/work-items', { json: { project_id: projectId, title: `${probe} live` } });
    expectStatus(item, 201, 'POST /api/v1/work-items');
    const itemId = item.data.data.id;
    await socket.next(
      'live work_item.created',
      60_000,
      (frame) => frame.event === 'live' && frame.channel === channel && frame.data?.type === 'work_item.created' && frame.data?.item_id === itemId,
    );
    ok('live update');

    // (k2) the item found by its key with the cached routes
    const byKey = await session.json('GET', `/api/v1/work-items/${identifier}-1`);
    expectStatus(byKey, 200, `GET /api/v1/work-items/${identifier}-1`);
    check(byKey.data?.data?.id === itemId, `item by key is ${byKey.data?.data?.id}`);
    ok('item by key');

    // (k3) renamed: the former key answers 301 to the current one, the former identifier still finds the project
    let renamed = randomIdentifier();
    while (renamed === identifier) {
      renamed = randomIdentifier();
    }
    expectStatus(await session.request('PATCH', `/api/v1/projects/${projectId}`, { json: { identifier: renamed } }), 200, 'PATCH identifier');
    const former = await session.request('GET', `/api/v1/work-items/${identifier}-1`);
    expectStatus(former, 301, `GET /api/v1/work-items/${identifier}-1 after the rename`);
    const location = new URL(former.headers.get('location') ?? '', base);
    check(location.pathname === `/api/v1/work-items/${renamed}-1`, `the former key leads to ${location.href}`);
    const current = await session.json('GET', location.pathname);
    expectStatus(current, 200, `GET ${location.pathname}`);
    check(current.data?.data?.id === itemId, `the current key finds ${current.data?.data?.id}`);
    const formerProject = await session.json('GET', `/api/v1/projects/${identifier}`);
    expectStatus(formerProject, 200, `GET /api/v1/projects/${identifier} after the rename`);
    check(formerProject.data?.data?.id === projectId, `the former identifier finds ${formerProject.data?.data?.id}`);
    ok('former key');

    // (l) the search worker and Meilisearch
    await until('search', 60_000, async () => {
      const found = await session.json('GET', `/api/v1/search?q=${probe}&types=items`);
      return (found.data?.data?.items ?? []).some((hit) => hit.id === itemId) ? true : undefined;
    });
    ok('search');

    // (m) nginx refuses a body over 32 MiB before PHP sees it
    const status = await oversized(base, '/api/v1/attachments', 34_603_008);
    check(status === 413, `oversized upload: status ${status}, expected 413`);
    ok('upload limit');

    // (m2) Reverb's HTTP API stays inside the stack: Laravel answers (404, or 405 from its fallback route)
    const apps = await session.request('POST', '/apps/werkbuch/events', { json: {} });
    const type = apps.headers.get('content-type') ?? '';
    check([404, 405].includes(apps.status), `POST /apps/werkbuch/events: status ${apps.status}: ${apps.text.slice(0, 300)}`);
    check(type.startsWith('text/html') || type.startsWith('application/json'), `POST /apps/werkbuch/events: content type ${type}`);
    ok('no reverb api');

    // (p) a picture gets its preview from the media worker (GD, the volume in the worker)
    const form = new FormData();
    form.append('project_id', projectId);
    form.append('kind', 'inline');
    form.append('file', new Blob([png(2, 2)], { type: 'image/png' }), 'smoke.png');
    const upload = await session.json('POST', '/api/v1/attachments', { body: form });
    expectStatus(upload, 201, 'POST /api/v1/attachments');
    const attachmentId = upload.data.data.id;
    await until('preview', 60_000, async () => {
      const attachment = await session.json('GET', `/api/v1/attachments/${attachmentId}`);
      return attachment.data?.data?.preview_url ? true : undefined;
    });
    ok('preview');
    // the file over the web route: {attachment} binds there too
    const file = await session.request('GET', `/attachments/${attachmentId}`, { headers: { Accept: 'image/png,*/*' } });
    expectStatus(file, 200, `GET /attachments/${attachmentId}`);
    check(file.headers.get('content-type') === 'image/png', `the attachment comes as ${file.headers.get('content-type')}`);
    ok('attachment file');

    // (n) delete the project again (PurgeProject in the queue)
    expectStatus(await session.request('DELETE', `/api/v1/projects/${projectId}`), 202, 'DELETE /api/v1/projects');
    projectId = null;
    ok('delete');
  } finally {
    socket.close();
    if (projectId !== null) {
      await session.request('DELETE', `/api/v1/projects/${projectId}`).catch(() => undefined);
    }
  }

  // (o) no HSTS from the container, the base's other headers stay
  const up = await session.request('GET', '/up');
  check(!up.headers.has('strict-transport-security'), `/up sends Strict-Transport-Security: ${up.headers.get('strict-transport-security')}`);
  check(up.headers.get('x-content-type-options') === 'nosniff', `/up X-Content-Type-Options is ${up.headers.get('x-content-type-options')}`);
  ok('headers');

  log('smoke: ok');
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run(process.env).catch((error) => {
    console.error(`smoke: failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  });
}
