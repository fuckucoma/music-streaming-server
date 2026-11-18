const prisma = require('../lib/prisma');
const { readTelegramUser } = require('../services/telegramInitData');
const { issueToken } = require('../services/tokens');

function telegramPhotoUrl(photo) {
  if (!photo) return null;
  try {
    const url = new URL(photo);
    return url.protocol === 'https:' && !url.username && !url.password ? url.href : null;
  } catch {
    return null;
  }
}

exports.telegramAuth = async (req, res, next) => {
  const { initData } = req.body ?? {};
  if (typeof initData !== 'string' || !initData) {
    return res.status(400).json({ error: 'initData required' });
  }
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  if (!botToken) return res.status(503).json({ error: 'Telegram login unavailable' });

  const telegramUser = readTelegramUser(initData, botToken);
  if (!telegramUser) return res.status(401).json({ error: 'Invalid or expired Telegram session' });

  const telegramId = String(telegramUser.id);
  const details = {
    telegramName: [telegramUser.first_name, telegramUser.last_name].filter(Boolean).join(' ') ||
      telegramUser.username || `User${telegramId}`,
    telegramUsername: telegramUser.username ?? null,
    telegramPhotoUrl: telegramPhotoUrl(telegramUser.photo_url),
  };

  try {
    const user = await prisma.user.upsert({
      where: { telegramId },
      create: { telegramId, ...details },
      update: details,
      select: { id: true, isAdmin: true, telegramId: true, telegramName: true, profileImageUrl: true, telegramPhotoUrl: true },
    });
    return res.set('Cache-Control', 'no-store').json({
      token: issueToken(user),
      user: {
        id: user.id,
        displayName: user.telegramName,
        profileImageUrl: user.profileImageUrl ?? user.telegramPhotoUrl ?? null,
        telegramId: user.telegramId,
      },
    });
  } catch (error) {
    next(error);
  }
};
