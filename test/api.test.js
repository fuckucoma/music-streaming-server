const assert = require('node:assert/strict');
const { createHmac } = require('node:crypto');
const { readFile } = require('node:fs/promises');
const { once } = require('node:events');
const path = require('node:path');
const { after, before, test } = require('node:test');
const jwt = require('jsonwebtoken');

process.env.JWT_SECRET = 'api-test-signing-key-not-for-deployment';
process.env.TELEGRAM_BOT_TOKEN = '12345:fixture-only';
process.env.SUPABASE_URL = 'https://storage.example.test';
process.env.SUPABASE_SERVICE_KEY = 'fixture-service-key';
process.env.CORS_ORIGINS = '';
process.env.TRUST_PROXY_HOPS = '';

const prisma = require('../lib/prisma');
const { createApp } = require('../app');
const { issueToken } = require('../services/tokens');

const legacyFile = '1740390046835-6531966.mp3';
const storedFile = 'https://storage.example.test/storage/v1/object/public/tracks/test.mp3';
const track = {
  id: 1, title: 'Sample', artist: 'Artist', album: 'Album', duration: 90,
  imageUrl: null, filename: legacyFile,
};
const user = { id: 7, username: 'listener', isAdmin: false, profileImageUrl: null, authSessionVersion: 0 };
const memberToken = issueToken(user);
const authSessions = new Map();
let favorite;
let telegramUser;
let server;
let base;

before(async () => {
  // Real Express routes and middleware, with fixture data in place of external services.
  const account = id => id === user.id ? user : telegramUser?.id === id ? telegramUser : null;
  const matches = (record, fields) => record && Object.entries(fields).every(([key, value]) => record[key] === value);
  prisma.user.findUnique = async ({ where, select }) => {
    const result = account(where.id);
    if (!result || !select) return result;
    return Object.fromEntries(Object.keys(select).map((key) => [key, result[key]]));
  };
  prisma.user.upsert = async ({ where, create }) => {
    assert.equal(where.telegramId, '555');
    telegramUser = { ...create, id: 8, isAdmin: false, authSessionVersion: 0, telegramAuthVersion: 0 };
    return telegramUser;
  };
  prisma.user.findFirst = async ({ where }) => matches(account(where.id), where) ? { id: where.id } : null;
  prisma.$transaction = async (work) => work(prisma);
  prisma.authSession.create = async ({ data }) => {
    authSessions.set(data.id, { ...data, revokedAt: null });
  };
  prisma.authSession.createMany = async ({ data: [session] }) => {
    if (!authSessions.has(session.id)) await prisma.authSession.create({ data: session });
  };
  prisma.authSession.deleteMany = async () => ({ count: 0 });
  prisma.authSession.findUnique = async ({ where }) => authSessions.get(where.id) ?? null;
  prisma.authSession.findFirst = async ({ where: { expiresAt, user: owner, ...fields } }) => {
    const session = authSessions.get(fields.id);
    return matches(session, fields) && session.expiresAt > expiresAt.gt && matches(account(session.userId), owner)
      ? { id: session.id } : null;
  };
  prisma.track.findUnique = async ({ where }) => {
    if (where.id === 1) return track;
    if (where.id === 2) return { ...track, id: 2, filename: storedFile };
    return null;
  };
  prisma.track.findMany = async ({ where, orderBy, take } = {}) => {
    if (where?.OR) {
      assert.deepEqual(where.OR.map((rule) => Object.keys(rule)[0]), ['title', 'artist', 'album']);
    }
    if (where?.id?.in) {
      return [track, { ...track, id: 2 }].filter(x => where.id.in.includes(x.id));
    }
    if (orderBy) {
      assert.deepEqual(orderBy, { id: 'desc' });
      return [{ ...track, id: 2 }, track].filter(x => x.id < (where.id?.lt ?? Infinity)).slice(0, take);
    }
    return [track];
  };
  prisma.favorite.create = async ({ data }) => {
    assert.equal(data.userId, user.id);
    if (favorite) throw Object.assign(new Error('Already exists'), { code: 'P2002' });
    favorite = { favoriteId: 45, ...data };
    return favorite;
  };
  prisma.favorite.findUnique = async () => favorite;
  prisma.favorite.findMany = async ({ where }) => {
    assert.equal(where.userId, user.id);
    return favorite ? [{ favoriteId: favorite.favoriteId, trackId: favorite.trackId, track }] : [];
  };
  prisma.favorite.deleteMany = async ({ where }) => {
    assert.equal(where.userId, user.id);
    favorite = undefined;
    return { count: 1 };
  };

  server = createApp({ logRequests: false }).listen(0, '127.0.0.1');
  await once(server, 'listening');
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  if (server?.listening) await new Promise((resolve, reject) => server.close((err) => err ? reject(err) : resolve()));
  await prisma.$disconnect();
});

function call(route, { token, payload, method, headers, redirect } = {}) {
  return fetch(base + route, {
    method: method ?? (payload === undefined ? 'GET' : 'POST'),
    headers: {
      ...(payload === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    body: payload === undefined ? undefined : JSON.stringify(payload),
    redirect,
  });
}

test('catalog and album search are accessible as a guest', async () => {
  for (const route of ['/tracks', '/tracks/search?query=Album']) {
    const response = await call(route);
    assert.equal(response.status, 200);
    assert.equal((await response.json())[0].title, 'Sample');
  }
  assert.equal((await call('/tracks/search')).status, 400);
});

test('catalog pages advance by ID and track lookup is bounded', async () => {
  const first = await (await call('/tracks?limit=1')).json();
  assert.deepEqual(first.items.map(track => track.id), [2]);
  assert.equal(first.nextCursor, 2);
  const second = await (await call('/tracks?limit=1&before=2')).json();
  assert.deepEqual(second.items.map(track => track.id), [1]);
  assert.equal(second.nextCursor, null);
  const search = await (await call('/tracks/search?query=Album&limit=1')).json();
  assert.equal(search.nextCursor, 2);
  const selected = await (await call('/tracks/by-ids?ids=2,2,999')).json();
  assert.deepEqual(selected.map(track => track.id), [2]);
  for (const suffix of ['?limit=101', '?before=0', '/by-ids?ids=1,zero', '/by-ids']) {
    assert.equal((await call('/tracks' + suffix)).status, 400);
  }
});

test('profile accepts a current bearer token and rejects missing or expired sessions', async () => {
  const expired = jwt.sign({ userId: user.id }, process.env.JWT_SECRET, { expiresIn: -1 });
  for (const token of [undefined, expired]) {
    const response = await call('/users/profile', { token });
    assert.equal(response.status, 401);
    assert.equal(response.headers.get('www-authenticate'), 'Bearer');
  }
  const response = await call('/users/profile', { token: memberToken });
  assert.equal(response.status, 200);
  const profile = await response.json();
  assert.equal(profile.displayName, user.username);
  assert.ok(!Object.hasOwn(profile, 'password'));
});

test('Telegram accepts signed current data and rejects an expired launch', async () => {
  function initData(authDate) {
    const fields = {
      auth_date: String(authDate),
      user: JSON.stringify({ id: 555, first_name: 'Telegram', last_name: 'Listener' }),
    };
    const entries = Object.entries(fields).sort(([left], [right]) => left.localeCompare(right));
    const checkString = entries.map(([key, value]) => `${key}=${value}`).join('\n');
    const secret = createHmac('sha256', 'WebAppData').update(process.env.TELEGRAM_BOT_TOKEN).digest();
    const hash = createHmac('sha256', secret).update(checkString).digest('hex');
    return new URLSearchParams({ ...fields, hash }).toString();
  }
  const now = Math.floor(Date.now() / 1000);
  assert.equal((await call('/auth/telegram', { payload: { initData: initData(now - 86_401) } })).status, 401);
  const response = await call('/auth/telegram', { payload: { initData: initData(now) } });
  assert.equal(response.status, 200);
  const { token, user: profile } = await response.json();
  assert.equal(profile.telegramId, '555');
  assert.equal(profile.displayName, 'Telegram Listener');
  assert.equal((await call('/users/profile', { token })).status, 200);
});

test('admin and track mutations require the current admin role', async () => {
  const oldAdminToken = issueToken({ ...user, isAdmin: true });
  for (const attempt of [
    { route: '/api/admin/dashboard' },
    { route: '/tracks/add-track', method: 'POST' },
    { route: '/tracks/upload-multiple', method: 'POST' },
    { route: '/tracks/delete/1', method: 'DELETE' },
  ]) {
    const { route, method } = attempt;
    assert.equal((await call(route, { method })).status, 401);
    assert.equal((await call(route, { method, token: oldAdminToken })).status, 403);
  }
});

test('favorites are scoped to a user and repeated changes are safe', async () => {
  assert.equal((await call('/favorites/get')).status, 401);
  const payload = { trackId: 1 };
  const session = { token: memberToken };
  assert.equal((await call('/favorites/add', { ...session, payload: { trackId: 'a' } })).status, 400);
  assert.equal((await call('/favorites/add', { ...session, payload })).status, 201);
  assert.equal((await call('/favorites/add', { ...session, payload })).status, 200);
  const result = await (await call('/favorites/get', session)).json();
  assert.equal(result.favorites[0].trackId, 1);
  assert.equal(result.favorites[0].album, 'Album');
  assert.equal((await call('/favorites/remove', { ...session, payload })).status, 200);
  assert.equal((await call('/favorites/remove', { ...session, payload })).status, 200);
  assert.deepEqual(await (await call('/favorites/get', session)).json(), { favorites: [] });
});

test('the legacy stream serves bytes and the storage stream redirects to the CDN', async () => {
  const response = await call('/tracks/1/stream', { headers: { Range: 'bytes=0-31' } });
  assert.equal(response.status, 206);
  assert.match(response.headers.get('content-range'), /^bytes 0-31\/\d+$/);
  const file = await readFile(path.join(__dirname, '..', 'public', 'tracks', legacyFile));
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), file.subarray(0, 32));

  const head = await call('/tracks/1/stream', { method: 'HEAD' });
  assert.equal(head.status, 200);
  assert.equal(Number(head.headers.get('content-length')), file.length);
  const remote = await call('/tracks/2/stream', { redirect: 'manual' });
  assert.equal(remote.status, 302);
  assert.equal(remote.headers.get('location'), storedFile);
  assert.equal((await call('/tracks/3/stream')).status, 404);
});

test('catalog and playback CORS allow the canonical site and redirect alias only', async () => {
  const allowed = ['https://muisicunderlab.vercel.app', 'https://underlab-phi.vercel.app'];
  for (const origin of [...allowed, 'https://unrelated.vercel.app']) {
    const [catalog, playback] = await Promise.all([
      call('/tracks', { headers: { Origin: origin } }),
      call('/playback/devices', {
        method: 'OPTIONS',
        headers: {
          Origin: origin,
          'Access-Control-Request-Method': 'POST',
          'Access-Control-Request-Headers': 'authorization,content-type',
        },
      }),
    ]);
    assert.equal(catalog.status, 200);
    const expectedOrigin = allowed.includes(origin) ? origin : null;
    assert.equal(catalog.headers.get('access-control-allow-origin'), expectedOrigin);
    assert.equal(playback.headers.get('access-control-allow-origin'), expectedOrigin);
    if (expectedOrigin) {
      assert.equal(playback.status, 204);
      assert.match(playback.headers.get('access-control-allow-headers'), /\bAuthorization\b/i);
    }
  }
});
