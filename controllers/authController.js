const crypto           = require('crypto');
const jwt              = require('jsonwebtoken');
const { PrismaClient } = require('@prisma/client');
require('dotenv').config();

const prisma     = new PrismaClient();
const JWT_SECRET = process.env.JWT_SECRET;
const BOT_TOKEN  = process.env.TELEGRAM_BOT_TOKEN;
const JWT_EXPIRES_IN = '30d';

/**
 * Verify Telegram WebApp initData using HMAC-SHA256.
 * https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
 */
function verifyInitData(initData) {
  const params = new URLSearchParams(initData);
  const hash   = params.get('hash');
  if (!hash) throw new Error('No hash in initData');

  params.delete('hash');

  const checkString = [...params.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join('\n');

  const secret = crypto
    .createHmac('sha256', 'WebAppData')
    .update(BOT_TOKEN)
    .digest();

  const expected = crypto
    .createHmac('sha256', secret)
    .update(checkString)
    .digest('hex');

  if (expected !== hash) throw new Error('Invalid signature');

  // Reject stale data (older than 24h)
  const authDate = parseInt(params.get('auth_date') ?? '0', 10);
  if (Math.floor(Date.now() / 1000) - authDate > 86400) {
    throw new Error('initData expired');
  }

  const userStr = params.get('user');
  if (!userStr) throw new Error('No user in initData');
  return JSON.parse(userStr);
}

/**
 * POST /auth/telegram
 * Body: { initData: string }
 * Returns: { token, user }
 */
exports.telegramAuth = async (req, res) => {
  const { initData } = req.body;

  if (!initData) {
    return res.status(400).json({ error: 'initData required' });
  }
  if (!BOT_TOKEN) {
    return res.status(500).json({ error: 'TELEGRAM_BOT_TOKEN not set on server' });
  }

  try {
    const tgUser = verifyInitData(initData);

    const telegramId   = String(tgUser.id);
    const telegramName = [tgUser.first_name, tgUser.last_name]
      .filter(Boolean).join(' ') || tgUser.username || `User${telegramId}`;

    // Find or auto-create user by Telegram ID
    let user = await prisma.user.findUnique({ where: { telegramId } });

    if (!user) {
  user = await prisma.user.create({
    data: {
      telegramId,
      telegramName,
      telegramUsername: tgUser.username ?? null,
      telegramPhotoUrl: tgUser.photo_url ?? null,
    },
  });

} else {

  user = await prisma.user.update({
    where: {
      telegramId
    },
    data: {
      telegramName,
      telegramUsername: tgUser.username ?? null,
      telegramPhotoUrl: tgUser.photo_url ?? null,
    },
  });

}

    const token = jwt.sign(
      { userId: user.id, isAdmin: user.isAdmin, telegramId },
      JWT_SECRET,
      { expiresIn: JWT_EXPIRES_IN },
    );

    console.log(`[Auth] Telegram login: ${telegramName}`);

    return res.json({
      token,
      user: {
        id: user.id,
        displayName: user.telegramName ?? user.username ?? `User${user.id}`,
        profileImageUrl: user.profileImageUrl ?? null,
        telegramId: user.telegramId,
      },
    });

  } catch (err) {
    console.error('[Auth] Telegram auth error:', err.message);
    return res.status(401).json({ error: err.message });
  }
};