const { createHash, randomUUID } = require('node:crypto');
const prisma = require('../lib/prisma');
const { issueToken, SESSION_TTL_SECONDS } = require('./tokens');

async function startAuthSession(db, user, userAgent) {
  const createdAt = new Date(Math.floor(Date.now() / 1000) * 1000);
  const session = {
    id: randomUUID(),
    userId: user.id,
    method: user.telegramId ? 'telegram' : 'password',
    authVersion: user.authSessionVersion ?? 0,
    telegramAuthVersion: user.telegramId ? user.telegramAuthVersion ?? 0 : null,
    userAgent: userAgent?.slice(0, 200) || null,
    createdAt,
    expiresAt: new Date(createdAt.getTime() + SESSION_TTL_SECONDS * 1000),
  };
  await db.authSession.deleteMany({ where: { userId: user.id, expiresAt: { lte: createdAt } } });
  await db.authSession.create({ data: session });
  return issueToken(user, session);
}

function legacySessionId(token) {
  const digest = createHash('sha256').update(token).digest('hex');
  return [digest.slice(0, 8), digest.slice(8, 12), digest.slice(12, 16),
    digest.slice(16, 20), digest.slice(20, 32)].join('-');
}

async function findAuthSession(claims, token, userAgent) {
  const now = new Date();
  const id = claims.sid ?? legacySessionId(token);
  const userId = claims.userId;
  const method = claims.telegramId ? 'telegram' : 'password';
  const authVersion = claims.authSessionVersion ?? 0;
  const telegramAuthVersion = claims.telegramId ? claims.telegramAuthVersion ?? 0 : null;
  const user = { authSessionVersion: authVersion };
  if (claims.telegramId) {
    user.telegramId = claims.telegramId;
    user.telegramAuthVersion = telegramAuthVersion;
  }
  const where = {
    id, userId, method, authVersion, telegramAuthVersion,
    revokedAt: null, expiresAt: { gt: now }, user,
  };
  const query = { where, select: { id: true } };
  const verified = { userId, sessionId: id, authVersion, method };
  if (await prisma.authSession.findFirst(query)) return verified;
  if (claims.sid || authVersion !== 0) return null;

  // Older signed tokens get one stable database row. Keep revoked rows until the JWT expires.
  if (await prisma.authSession.findUnique({ where: { id }, select: { id: true } })) return null;
  const account = await prisma.user.findFirst({ where: { id: userId, ...user }, select: { id: true } });
  if (!account) return null;

  try {
    await prisma.authSession.createMany({
      data: [{
        id, userId, method, authVersion, telegramAuthVersion,
        userAgent: userAgent?.slice(0, 200) || null,
        createdAt: new Date(claims.iat * 1000), expiresAt: new Date(claims.exp * 1000),
      }],
      skipDuplicates: true,
    });
  } catch (error) {
    if (error.code === 'P2003') return null;
    throw error;
  }
  return await prisma.authSession.findFirst(query) ? verified : null;
}

async function revokeAuthSession(userId, sessionId) {
  const now = new Date();
  const { count } = await prisma.authSession.updateMany({
    where: { id: sessionId, userId, revokedAt: null, expiresAt: { gt: now } },
    data: { revokedAt: now },
  });
  return count === 1;
}

function revokeUserAuthSessions(db, userId, method) {
  return db.authSession.updateMany({
    where: { userId, method, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

async function listAuthSessions({ userId, sessionId, authVersion }) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { telegramId: true, telegramAuthVersion: true, authSessionVersion: true },
  });
  if (!user || user.authSessionVersion !== authVersion) return [];
  const methods = [{ method: 'password' }];
  if (user.telegramId) methods.push({ method: 'telegram', telegramAuthVersion: user.telegramAuthVersion });

  const sessions = await prisma.authSession.findMany({
    where: { userId, authVersion, revokedAt: null, expiresAt: { gt: new Date() }, OR: methods },
    select: { id: true, method: true, userAgent: true, createdAt: true, expiresAt: true },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
  });
  return sessions.map((session) => ({ ...session, current: session.id === sessionId }));
}

module.exports = { startAuthSession, findAuthSession, revokeAuthSession, revokeUserAuthSessions, listAuthSessions };
