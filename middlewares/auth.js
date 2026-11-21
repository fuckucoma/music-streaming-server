const prisma = require('../lib/prisma');
const { verifyToken } = require('../services/tokens');

function unauthorized(res) {
  return res.set('WWW-Authenticate', 'Bearer').status(401).json({ error: 'Authentication required' });
}

async function readAuthenticatedUser(authorizationHeader) {
  const match = /^Bearer\s+(\S+)$/i.exec(authorizationHeader ?? '');
  if (!match) return null;
  let claims;
  try {
    claims = verifyToken(match[1]);
  } catch {
    return null;
  }
  if (claims.telegramId) {
    const current = await prisma.user.findUnique({
      where: { id: claims.userId },
      select: { telegramId: true, telegramAuthVersion: true },
    });
    if (!current || current.telegramId !== claims.telegramId ||
        (current.telegramAuthVersion ?? 0) !== (claims.telegramAuthVersion ?? 0)) {
      return null;
    }
  }
  return { userId: claims.userId };
}

async function authenticateToken(req, res, next) {
  try {
    const user = await readAuthenticatedUser(req.headers.authorization);
    if (!user) return unauthorized(res);
    req.user = user;
  } catch (error) {
    return next(error);
  }
  next();
}

async function requireAdmin(req, res, next) {
  if (!req.user) return unauthorized(res);
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user.userId },
      select: { isAdmin: true },
    });
    if (!user) return unauthorized(res);
    if (!user.isAdmin) return res.status(403).json({ error: 'Forbidden' });
    req.user.isAdmin = true;
  } catch (error) {
    return next(error);
  }
  next();
}

module.exports = { authenticateToken, readAuthenticatedUser, requireAdmin };
