const WINDOW_MS = 10 * 60 * 1000;
const MAX_IP_KEYS = 10_000;
const MAX_ACCOUNT_KEYS = 20_000;
const byIp = new Map();
const byAccount = new Map();
let resetAt = Date.now() + WINDOW_MS;

function allowAttempt(attempts, key, limit, maxKeys) {
  const count = attempts.get(key) ?? 0;
  if (count >= limit || (!count && attempts.size >= maxKeys)) return false;
  attempts.set(key, count + 1);
  return true;
}

function limitCredentialAttempts(req, res, next) {
  const now = Date.now();
  if (now >= resetAt) {
    byIp.clear();
    byAccount.clear();
    resetAt = now + WINDOW_MS;
  }

  const address = req.ip ?? req.socket.remoteAddress ?? 'unknown';
  const username = req.body?.username;
  let accountKey;
  if (req.user) accountKey = `${address}\0id:${req.user.userId}`;
  else if (typeof username === 'string' && username.length <= 1024) {
    accountKey = `${address}\0name:${username.trim().toLowerCase()}`;
  }
  if (!allowAttempt(byIp, address, 240, MAX_IP_KEYS) ||
      (accountKey && !allowAttempt(byAccount, accountKey, 15, MAX_ACCOUNT_KEYS))) {
    res.set('Retry-After', String(Math.ceil((resetAt - now) / 1000)));
    return res.status(429).json({ error: 'Too many requests. Try again later.' });
  }
  next();
}

module.exports = { limitCredentialAttempts };
