const assert = require('node:assert/strict');
const { createHmac, randomBytes, randomInt, randomUUID } = require('node:crypto');
const { once } = require('node:events');
const { test } = require('node:test');

const database = process.env.TEST_DATABASE_URL;

// Use a migrated disposable PostgreSQL database. The default API suite needs no database.
test('linked devices share a queue, receive remote controls and hand off one output', {
  skip: !database && 'Set TEST_DATABASE_URL to a migrated disposable PostgreSQL database',
  timeout: 20_000,
}, async (t) => {
  process.env.DATABASE_URL = database;
  process.env.DIRECT_URL = database;
  process.env.JWT_SECRET = 'shared-playback-integration-signing-fixture';
  process.env.TELEGRAM_BOT_TOKEN = '12345:shared-playback-test-fixture';
  process.env.SUPABASE_URL = 'https://storage.example.test';
  process.env.SUPABASE_SERVICE_KEY = 'test-fixture';

  const prisma = require('../lib/prisma');
  const { createApp } = require('../app');
  const { issueToken } = require('../services/tokens');
  const connection = createApp({ logRequests: false }).listen(0, '127.0.0.1');
  await once(connection, 'listening');
  const base = `http://127.0.0.1:${connection.address().port}`;
  const username = `test-${randomUUID()}`;
  const telegramId = String(randomInt(1_000_000_000, 2_000_000_000));
  const password = 'fixture-password-only';
  const trackIds = [];
  const events = new AbortController();

  t.after(async () => {
    events.abort();
    connection.closeAllConnections();
    await new Promise((resolve) => connection.close(resolve));
    try {
      const users = await prisma.user.findMany({
        where: { OR: [{ username }, { telegramId }, { username: `${username}-other` }] },
        select: { id: true },
      });
      const ids = users.map((user) => user.id);
      await prisma.favorite.deleteMany({ where: { userId: { in: ids } } });
      await prisma.user.deleteMany({ where: { id: { in: ids } } });
      await prisma.track.deleteMany({ where: { id: { in: trackIds } } });
    } finally {
      await prisma.$disconnect();
    }
  });

  async function api(path, { token, body, method = body ? 'POST' : 'GET', status } = {}) {
    const response = await fetch(base + path, {
      method,
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(5_000),
    });
    const payload = await response.json();
    if (status != null) assert.equal(response.status, status, JSON.stringify(payload));
    else assert.ok(response.ok, `${path}: ${JSON.stringify(payload)}`);
    return payload;
  }

  const { token: browser } = await api('/users/register', { body: { username, password } });
  const initData = signedTelegramLaunch(telegramId);
  const { token: oldTelegram } = await api('/auth/telegram', { body: { initData } });
  const [{ id: first }, { id: second }] = await prisma.track.createManyAndReturn({
    data: ['One', 'Two'].map((title) => ({
      title, artist: 'Playback fixture', duration: 180, filename: 'unused.mp3',
    })),
    select: { id: true },
  });
  trackIds.push(first, second);

  await api('/favorites/add', { token: browser, body: { trackId: first } });
  await api('/favorites/add', { token: oldTelegram, body: { trackId: first } });
  await api('/favorites/add', { token: oldTelegram, body: { trackId: second } });
  const { code } = await api('/auth/telegram/link-code', { token: browser, body: { password } });
  const preview = await api('/auth/telegram/link/preview', { body: { code, initData } });
  assert.equal(preview.mergeRequired, true);
  const { token: telegram } = await api('/auth/telegram/link', {
    body: { code, initData, confirmMerge: true },
  });
  const [siteProfile, telegramProfile] = await Promise.all([
    api('/users/profile', { token: browser }),
    api('/users/profile', { token: telegram }),
  ]);
  assert.equal(telegramProfile.id, siteProfile.id);
  await api('/users/profile', { token: oldTelegram, status: 401 });
  const list = await api('/favorites/get', { token: telegram });
  assert.deepEqual(list.favorites.map((item) => item.trackId).sort(), [first, second].sort());

  const desktop = device('Desktop', 'browser');
  const phone = device('Telegram', 'telegram');
  await api('/playback/devices', { token: browser, body: desktop });
  const home = await api('/playback/devices', { token: telegram, body: phone });
  const stream = await fetch(base + '/playback/events', {
    headers: { Authorization: `Bearer ${telegram}`, Accept: 'text/event-stream' },
    signal: events.signal,
  });
  assert.equal(stream.status, 200);
  assert.match(stream.headers.get('content-type'), /^text\/event-stream/);
  const read = readSessionEvent(stream.body);

  function command(token, credentials, expectedVersion, details, status) {
    const { deviceId, deviceKey } = credentials;
    return api('/playback/command', {
      token, body: { deviceId, deviceKey, expectedVersion, command: details }, status,
    });
  }

  const start = await command(browser, desktop, home.session.version, {
    type: 'play', trackId: first, queue: [first, second], position: 12,
  });
  const streamed = await read((snapshot) => snapshot.session.version === start.session.version);
  assert.equal(streamed.session.activeDeviceId, desktop.deviceId);
  assert.deepEqual(streamed.session.queue, [first, second]);
  assert.ok(streamed.session.position >= 12);
  const corrected = await api('/playback/heartbeat', {
    token: browser,
    body: { ...desktop, report: { trackId: first, version: start.session.version, position: 15 } },
  });
  assert.equal(corrected.session.version, start.session.version);
  assert.ok(corrected.session.position >= 15);

  const pause = await command(telegram, phone, start.session.version, { type: 'pause' });
  assert.equal((await api('/playback/session', { token: browser })).session.playing, false);
  const resume = await command(telegram, phone, pause.session.version, { type: 'play' });
  assert.equal(resume.session.activeDeviceId, desktop.deviceId);
  const handoff = await command(telegram, phone, resume.session.version, {
    type: 'transfer', targetDeviceId: phone.deviceId,
  });
  assert.equal(handoff.session.activeDeviceId, desktop.deviceId);
  assert.equal(handoff.session.pendingDeviceId, phone.deviceId);
  assert.equal(handoff.session.playing, false);
  await api('/playback/ack', {
    token: telegram,
    body: { ...phone, expectedVersion: handoff.session.version },
    status: 403,
  });
  const switched = await api('/playback/ack', {
    token: browser,
    body: {
      deviceId: desktop.deviceId, deviceKey: desktop.deviceKey,
      expectedVersion: handoff.session.version, position: 16,
    },
  });
  assert.equal(switched.session.activeDeviceId, phone.deviceId);
  assert.equal(switched.session.pendingDeviceId, null);
  assert.equal(switched.session.playing, true);
  assert.ok(switched.session.position >= 16);
  await command(browser, desktop, resume.session.version, { type: 'pause' }, 409);

  const waiting = await command(browser, desktop, switched.session.version, {
    type: 'transfer', targetDeviceId: desktop.deviceId,
  });
  assert.equal(waiting.session.activeDeviceId, phone.deviceId);
  // Simulate the outgoing device losing its connection until its lease expired.
  await prisma.playbackSession.update({
    where: { userId: siteProfile.id },
    data: { leaseUntil: new Date(Date.now() - 1_000) },
  });
  const recovered = await api('/playback/heartbeat', { token: browser, body: desktop });
  assert.equal(recovered.session.activeDeviceId, desktop.deviceId);
  assert.equal(recovered.session.pendingDeviceId, null);
  assert.equal(recovered.session.playing, true);

  const otherUser = await prisma.user.create({ data: { username: `${username}-other` } });
  const otherToken = issueToken(otherUser);
  const isolated = await api('/playback/session', { token: otherToken });
  assert.equal(isolated.session.trackId, null);
  assert.deepEqual(isolated.devices, []);
  await command(otherToken, desktop, recovered.session.version, { type: 'pause' }, 403);

  await api('/auth/telegram/link', { token: browser, body: { password }, method: 'DELETE' });
  await api('/playback/session', { token: telegram, status: 401 });
  const changed = await command(browser, desktop, recovered.session.version, { type: 'pause' });
  await assert.rejects(read((snapshot) => snapshot.session.version === changed.session.version),
    /The event stream closed before the expected state arrived/);
});

function signedTelegramLaunch(id) {
  const authDate = String(Math.floor(Date.now() / 1_000));
  const user = JSON.stringify({ id: Number(id), first_name: 'Telegram fixture' });
  const secret = createHmac('sha256', 'WebAppData').update(process.env.TELEGRAM_BOT_TOKEN).digest();
  const hash = createHmac('sha256', secret).update(`auth_date=${authDate}\nuser=${user}`).digest('hex');
  return new URLSearchParams({ auth_date: authDate, user, hash }).toString();
}

function device(name, platform) {
  return { deviceId: randomUUID(), deviceKey: randomBytes(32).toString('base64url'), name, platform };
}

function readSessionEvent(stream) {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  return async (matches) => {
    while (true) {
      const end = buffer.indexOf('\n\n');
      if (end !== -1) {
        const frame = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        const data = frame.split('\n').find((line) => line.startsWith('data: '));
        if (data) {
          const snapshot = JSON.parse(data.slice(6));
          if (matches(snapshot)) return snapshot;
        }
      } else {
        const { done, value } = await reader.read();
        assert.equal(done, false, 'The event stream closed before the expected state arrived');
        buffer += decoder.decode(value, { stream: true });
      }
    }
  };
}
