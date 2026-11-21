const prisma = require('../lib/prisma');
const { telegramIdentity } = require('../services/telegramIdentity');
const { readTelegramUser } = require('../services/telegramInitData');
const {
  TelegramLinkError, createTelegramLinkCode, previewTelegramLink, confirmTelegramLink, unlinkTelegram,
} = require('../services/telegramLink');
const { issueToken } = require('../services/tokens');

const LINK_INIT_DATA_MAX_AGE = 5 * 60;

exports.telegramAuth = async (req, res, next) => {
  const { initData } = req.body ?? {};
  if (typeof initData !== 'string' || !initData) {
    return res.status(400).json({ error: 'initData required' });
  }
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  if (!botToken) return res.status(503).json({ error: 'Telegram login unavailable' });

  const telegramUser = readTelegramUser(initData, botToken);
  if (!telegramUser) return res.status(401).json({ error: 'Invalid or expired Telegram session' });

  const { telegramId, ...details } = telegramIdentity(telegramUser);

  try {
    const user = await prisma.user.upsert({
      where: { telegramId },
      create: { telegramId, ...details },
      update: details,
      select: {
        id: true, isAdmin: true, telegramId: true, telegramAuthVersion: true,
        telegramName: true, profileImageUrl: true, telegramPhotoUrl: true,
      },
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

function linkIdentity(initData) {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  if (!botToken) throw new TelegramLinkError(503, 'Telegram login unavailable');
  const user = readTelegramUser(initData, botToken, undefined, LINK_INIT_DATA_MAX_AGE);
  if (!user) throw new TelegramLinkError(401, 'Reopen the Mini App to confirm Telegram again');
  return telegramIdentity(user);
}

function linkHandler(action) {
  return async (req, res, next) => {
    try {
      const data = await action(req, req.body ?? {});
      return res.set('Cache-Control', 'no-store').json(data);
    } catch (error) {
      if (error instanceof TelegramLinkError) return res.status(error.status).json({ error: error.message });
      return next(error);
    }
  };
}

exports.createLinkCode = linkHandler((req, { password }) => createTelegramLinkCode(req.user.userId, password));
exports.previewLink = linkHandler((req, { code, initData }) =>
  previewTelegramLink(code, linkIdentity(initData).telegramId));
exports.confirmLink = linkHandler(async (req, { code, initData, confirmMerge }) => {
  const user = await confirmTelegramLink(code, linkIdentity(initData), confirmMerge === true);
  return { token: issueToken(user) };
});
exports.unlinkTelegram = linkHandler(async (req, { password }) => {
  const user = await unlinkTelegram(req.user.userId, password);
  return { token: issueToken(user) };
});
