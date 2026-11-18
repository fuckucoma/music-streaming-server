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
const user = { id: 7, username: 'listener', isAdmin: false, profileImageUrl: null };
const memberToken = issueToken(user);
let favorite;
let telegramUser;
let server;
let base;

before(async () => {
  // Real Express routes and middleware, with fixture data in place of external services.
  prisma.user.findUnique = async ({ where, select }) => {
    const result = where.id === user.id ? user : telegramUser?.id === where.id ? telegramUser : null;
    if (!result || !select) return result;
    return Object.fromEntries(Object.keys(select).map((key) => [key, result[key]]));
  };
  prisma.user.upsert = async ({ where, create }) => {
    assert.equal(where.telegramId, '555');
    telegramUser = { ...create, id: 8, isAdmin: false };
    return telegramUser;
  };
  prisma.track.findUnique = async ({ where }) => {
    if (where.id === 1) return track;
    if (where.id === 2) return { ...track, id: 2, filename: storedFile };
    return null;
  };
  prisma.track.findMany = async ({ where } = {}) => {
    if (where) {
      assert.deepEqual(where.OR.map((rule) => Object.keys(rule)[0]), ['title', 'artist', 'album']);
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

test('CORS preflight allows the app origin and refuses unknown origins', async () => {
  for (const origin of ['https://underlab-phi.vercel.app', 'https://unrelated.vercel.app']) {
    const response = await call('/users/profile', {
      method: 'OPTIONS',
      headers: { Origin: origin, 'Access-Control-Request-Method': 'GET' },
    });
    assert.equal(response.headers.get('access-control-allow-origin'),
      origin === 'https://underlab-phi.vercel.app' ? origin : null);
  }
});
