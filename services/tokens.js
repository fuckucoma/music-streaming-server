const jwt = require('jsonwebtoken');

function issueToken(user) {
  const claims = { userId: user.id, isAdmin: user.isAdmin };
  if (user.telegramId) claims.telegramId = user.telegramId;
  return jwt.sign(claims, process.env.JWT_SECRET, { algorithm: 'HS256', expiresIn: '12h' });
}

function verifyToken(token) {
  const claims = jwt.verify(token, process.env.JWT_SECRET, { algorithms: ['HS256'] });
  if (!Number.isInteger(claims?.userId) || claims.userId <= 0 || claims.userId > 2147483647 ||
      !Number.isFinite(claims.exp)) {
    throw new Error('Invalid token claims');
  }
  return claims.userId;
}

module.exports = { issueToken, verifyToken };
