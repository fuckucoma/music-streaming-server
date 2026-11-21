const { createHmac, timingSafeEqual } = require('node:crypto');

const MAX_AGE_SECONDS = 24 * 60 * 60;
const CLOCK_SKEW_SECONDS = 60;
const MAX_INIT_DATA_LENGTH = 16_384;

// https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
function readTelegramUser(initData, botToken, now = Math.floor(Date.now() / 1000), maxAgeSeconds = MAX_AGE_SECONDS) {
  if (typeof initData !== 'string' || initData.length === 0 || initData.length > MAX_INIT_DATA_LENGTH) {
    return null;
  }
  const params = new URLSearchParams(initData);
  const fields = new Map();
  for (const [key, value] of params) {
    if (fields.has(key) || !/^[A-Za-z0-9_]+$/.test(key) || /[\r\n]/.test(value)) return null;
    fields.set(key, value);
  }

  const hash = fields.get('hash');
  const authDate = fields.get('auth_date');
  if (!hash || !/^[a-f0-9]{64}$/i.test(hash) || !authDate || !/^\d+$/.test(authDate)) return null;
  const timestamp = Number(authDate);
  if (!Number.isSafeInteger(timestamp) || timestamp <= 0 || now - timestamp > maxAgeSeconds ||
      timestamp - now > CLOCK_SKEW_SECONDS) return null;

  fields.delete('hash');
  const checkString = [...fields.keys()].sort().map((key) => `${key}=${fields.get(key)}`).join('\n');
  const secret = createHmac('sha256', 'WebAppData').update(botToken).digest();
  const expected = createHmac('sha256', secret).update(checkString).digest();
  if (!timingSafeEqual(expected, Buffer.from(hash, 'hex'))) return null;

  try {
    const user = JSON.parse(fields.get('user'));
    if (!user || !Number.isSafeInteger(user.id) || user.id <= 0 || typeof user.first_name !== 'string') {
      return null;
    }
    if (['last_name', 'username', 'photo_url'].some((field) => user[field] != null && typeof user[field] !== 'string')) {
      return null;
    }
    return user;
  } catch {
    return null;
  }
}

module.exports = { readTelegramUser };
