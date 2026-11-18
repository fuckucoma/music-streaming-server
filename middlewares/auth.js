const prisma = require('../lib/prisma');
const { verifyToken } = require('../services/tokens');

function unauthorized(res) {
  return res.set('WWW-Authenticate', 'Bearer').status(401).json({ error: 'Authentication required' });
}

function authenticateToken(req, res, next) {
  const match = /^Bearer\s+(\S+)$/i.exec(req.headers.authorization ?? '');
  if (!match) return unauthorized(res);
  try {
    req.user = { userId: verifyToken(match[1]) };
  } catch {
    return unauthorized(res);
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

module.exports = { authenticateToken, requireAdmin };
