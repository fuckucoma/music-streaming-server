const jwt = require('jsonwebtoken');

const SESSION_TTL_SECONDS = 12 * 60 * 60;
const SESSION_ID_PATTERN = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/;

function issueToken(user, session) {
  const claims = { userId: user.id, isAdmin: user.isAdmin };
  if (user.telegramId) {
    claims.telegramId = user.telegramId;
    claims.telegramAuthVersion = user.telegramAuthVersion ?? 0;
  }
  if (session) {
    claims.sid = session.id;
    claims.authSessionVersion = session.authVersion;
    claims.iat = Math.floor(session.createdAt.getTime() / 1000);
    claims.exp = Math.floor(session.expiresAt.getTime() / 1000);
    return jwt.sign(claims, process.env.JWT_SECRET, { algorithm: 'HS256' });
  }
  return jwt.sign(claims, process.env.JWT_SECRET, { algorithm: 'HS256', expiresIn: SESSION_TTL_SECONDS });
}

function verifyToken(token) {
  const claims = jwt.verify(token, process.env.JWT_SECRET, { algorithms: ['HS256'] });
  if (!Number.isInteger(claims?.userId) || claims.userId <= 0 || claims.userId > 2147483647 ||
      !Number.isSafeInteger(claims.iat) || !Number.isSafeInteger(claims.exp) || claims.iat >= claims.exp) {
    throw new Error('Invalid token claims');
  }
  if (claims.telegramId !== undefined && (typeof claims.telegramId !== 'string' || !/^\d+$/.test(claims.telegramId))) {
    throw new Error('Invalid Telegram token claims');
  }
  if (claims.sid !== undefined && (typeof claims.sid !== 'string' || !SESSION_ID_PATTERN.test(claims.sid) ||
      !Number.isSafeInteger(claims.authSessionVersion) || claims.authSessionVersion < 0)) {
    throw new Error('Invalid session claims');
  }
  if (claims.telegramAuthVersion !== undefined &&
      (!Number.isSafeInteger(claims.telegramAuthVersion) || claims.telegramAuthVersion < 0)) {
    throw new Error('Invalid Telegram binding version');
  }
  return claims;
}

module.exports = { issueToken, verifyToken, SESSION_ID_PATTERN, SESSION_TTL_SECONDS };
