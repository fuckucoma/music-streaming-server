const assert = require('node:assert/strict');
const { randomInt, randomUUID } = require('node:crypto');
const { once } = require('node:events');
const { test } = require('node:test');

const database = process.env.TEST_DATABASE_URL;

test('login sessions revoke individually on request and together after a password change', {
  skip: !database && 'Set TEST_DATABASE_URL to a migrated disposable PostgreSQL database',
  timeout: 20_000,
}, async (t) => {
  process.env.DATABASE_URL = database;
  process.env.DIRECT_URL = database;
  process.env.JWT_SECRET = 'auth-session-integration-fixture';
  process.env.SUPABASE_URL = 'https://storage.example.test';
  process.env.SUPABASE_SERVICE_KEY = 'test-fixture';

  const prisma = require('../lib/prisma');
  const { createApp } = require('../app');
  const { startAuthSession } = require('../services/authSessions');
  const { issueToken, verifyToken } = require('../services/tokens');
  const server = createApp({ logRequests: false }).listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  const username = `auth-fixture-${randomUUID()}`;
  const outsiderName = `${username}-other`;
  const password = 'fixture-password';
  const newPassword = 'updated-fixture-password';

  t.after(async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    try {
      await prisma.user.deleteMany({ where: { username: { in: [username, outsiderName] } } });
    } finally {
      await prisma.$disconnect();
    }
  });

  async function call(path, { token, body, method = body ? 'POST' : 'GET', status = 200 } = {}) {
    const response = await fetch(base + path, {
      method,
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(5_000),
    });
    const data = await response.json();
    assert.equal(response.status, status, `${path}: ${response.status}`);
    return data;
  }

  const account = await call('/users/register', { body: { username, password }, status: 201 });
  const other = await call('/users/register', { body: { username: outsiderName, password }, status: 201 });
  const credentials = { username, password };
  const browser = account.token;
  const { token: remote } = await call('/users/login', { body: credentials });
  const { token: otherBrowser } = await call('/users/login', { body: credentials });
  assert.notEqual(remote, otherBrowser);
  const list = await call('/users/sessions', { token: browser });
  assert.equal(list.sessions.length, 3);
  assert.equal(list.sessions.filter((session) => session.current).length, 1);
  assert.equal(list.sessions.find((session) => session.current).id, verifyToken(browser).sid);
  assert.ok(!JSON.stringify(list).includes(browser));

  await call(`/users/sessions/${verifyToken(other.token).sid}`, { token: browser, method: 'DELETE', status: 404 });
  await call('/users/profile', { token: other.token });
  await call(`/users/sessions/${verifyToken(remote).sid}`, { token: browser, method: 'DELETE' });
  await call('/users/profile', { token: remote, status: 401 });
  await call('/users/logout', { token: otherBrowser, method: 'POST' });
  await call('/users/profile', { token: otherBrowser, status: 401 });
  assert.deepEqual((await call('/users/sessions', { token: browser })).sessions.map((session) => session.id), [verifyToken(browser).sid]);

  const legacy = issueToken({ id: other.userId });
  await call('/users/profile', { token: legacy });
  await call('/users/logout', { token: legacy, method: 'POST' });
  await call('/users/profile', { token: legacy, status: 401 });
  await call('/users/profile', { token: other.token });

  const unregisteredLegacy = issueToken({ id: account.userId });
  const telegramAccount = await prisma.user.update({
    where: { id: account.userId },
    data: { telegramId: String(randomInt(1_000_000_000, 2_000_000_000)) },
  });
  const telegram = await startAuthSession(prisma, telegramAccount);
  await call('/users/profile', { token: telegram });
  await call('/users/edit-pass', { token: browser, method: 'PUT', body: { currentPassword: password, newPassword } });
  for (const token of [browser, telegram, unregisteredLegacy]) await call('/users/profile', { token, status: 401 });
  await call('/users/login', { body: credentials, status: 401 });
  const fresh = await call('/users/login', { body: { username, password: newPassword } });
  await call('/users/profile', { token: fresh.token });
  await call('/users/profile', { token: other.token });
});
