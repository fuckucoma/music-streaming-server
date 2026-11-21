const assert = require('node:assert/strict');
const { createHash, randomInt, randomUUID } = require('node:crypto');
const { test } = require('node:test');
const bcrypt = require('bcrypt');

const database = process.env.TEST_DATABASE_URL;

test('Telegram link codes expire, are single-use, and unlink revokes old Telegram tokens', {
  skip: !database && 'Set TEST_DATABASE_URL to a migrated disposable PostgreSQL database',
  timeout: 20_000,
}, async (t) => {
  process.env.DATABASE_URL = database;
  process.env.DIRECT_URL = database;
  process.env.JWT_SECRET = 'telegram-link-integration-fixture';
  process.env.SUPABASE_URL = 'https://storage.example.test';
  process.env.SUPABASE_SERVICE_KEY = 'test-fixture';

  const prisma = require('../lib/prisma');
  const { readAuthenticatedUser } = require('../middlewares/auth');
  const { issueToken } = require('../services/tokens');
  const { createTelegramLinkCode, previewTelegramLink, confirmTelegramLink, unlinkTelegram } = require('../services/telegramLink');

  const username = `link-fixture-${randomUUID()}`;
  const password = 'link-fixture-password';
  const passwordHash = await bcrypt.hash(password, 4);
  const id = String(randomInt(3_000_000_000, 4_000_000_000));
  const identity = { telegramId: id, telegramName: 'Fixture', telegramUsername: null, telegramPhotoUrl: null };
  const ids = [];
  t.after(async () => {
    try {
      await prisma.user.deleteMany({ where: { id: { in: ids } } });
    } finally {
      await prisma.$disconnect();
    }
  });

  const browser = await prisma.user.create({ data: { username, password: passwordHash } });
  ids.push(browser.id);
  const browserToken = issueToken(browser);
  await assert.rejects(createTelegramLinkCode(browser.id, 'wrong'), { status: 400 });

  const previous = await createTelegramLinkCode(browser.id, password);
  const expiring = await createTelegramLinkCode(browser.id, password);
  await assert.rejects(previewTelegramLink(previous.code, id), { status: 404 });
  const row = await prisma.telegramLinkCode.findUnique({ where: { userId: browser.id } });
  assert.equal(row.codeHash, createHash('sha256').update(expiring.code).digest('hex'));
  assert.notEqual(row.codeHash, expiring.code);
  await prisma.telegramLinkCode.update({ where: { userId: browser.id }, data: { expiresAt: new Date(0) } });
  await assert.rejects(confirmTelegramLink(expiring.code, identity, true), { status: 404 });

  const duplicate = await prisma.user.create({ data: { ...identity, username: `${username}-duplicate`, password: passwordHash } });
  ids.push(duplicate.id);
  const invite = await createTelegramLinkCode(browser.id, password);
  await assert.rejects(previewTelegramLink(invite.code, id), { status: 409 });
  await assert.rejects(confirmTelegramLink(invite.code, identity, true), { status: 409 });
  assert.equal((await prisma.user.findUnique({ where: { id: duplicate.id } })).telegramId, id);

  await prisma.user.update({ where: { id: duplicate.id }, data: { password: null, isAdmin: true } });
  await assert.rejects(confirmTelegramLink(invite.code, identity, true), { status: 409 });
  await prisma.user.update({ where: { id: duplicate.id }, data: { isAdmin: false } });
  assert.deepEqual(await previewTelegramLink(invite.code, id), { username, mergeRequired: true });
  await assert.rejects(confirmTelegramLink(invite.code, identity, false), { status: 409 });

  const linked = await confirmTelegramLink(invite.code, identity, true);
  assert.equal(linked.id, browser.id);
  assert.equal(await prisma.user.findUnique({ where: { id: duplicate.id } }), null);
  const linkedToken = issueToken(linked);
  assert.deepEqual(await readAuthenticatedUser(`Bearer ${linkedToken}`), { userId: browser.id });
  await assert.rejects(confirmTelegramLink(invite.code, identity, true), { status: 404 });

  await assert.rejects(unlinkTelegram(browser.id, 'wrong'), { status: 400 });
  await unlinkTelegram(browser.id, password);
  assert.equal(await readAuthenticatedUser(`Bearer ${linkedToken}`), null);
  assert.deepEqual(await readAuthenticatedUser(`Bearer ${browserToken}`), { userId: browser.id });
  const fresh = await createTelegramLinkCode(browser.id, password);
  const relinked = await confirmTelegramLink(fresh.code, identity, false);
  assert.equal(await readAuthenticatedUser(`Bearer ${linkedToken}`), null);
  assert.deepEqual(await readAuthenticatedUser(`Bearer ${issueToken(relinked)}`), { userId: browser.id });
});
