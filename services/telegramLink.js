const bcrypt = require('bcrypt');
const { createHash, randomBytes } = require('node:crypto');
const prisma = require('../lib/prisma');
const { cleanupUserAvatar } = require('./userAccounts');

const LINK_LIFETIME_MS = 5 * 60_000;
const linkableFields = {
  id: true, username: true, password: true, isAdmin: true, profileImageUrl: true,
  telegramId: true, telegramAuthVersion: true,
};

class TelegramLinkError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function hashCode(code) {
  if (typeof code !== 'string' || !/^[A-Za-z0-9_-]{24}$/.test(code)) {
    throw new TelegramLinkError(400, 'Enter the code shown on the website');
  }
  return createHash('sha256').update(code).digest('hex');
}

const expiredLink = () => new TelegramLinkError(404, 'Link code is invalid, expired or already used');

async function passwordAccount(id, password) {
  if (typeof password !== 'string' || !password || Buffer.byteLength(password) > 1024) {
    throw new TelegramLinkError(400, 'Enter your website password');
  }
  const account = await prisma.user.findUnique({ where: { id }, select: linkableFields });
  if (!account?.username || !account.password) throw new TelegramLinkError(409, 'A website login is required');
  if (!await bcrypt.compare(password, account.password)) {
    throw new TelegramLinkError(400, 'Website password is incorrect');
  }
  return account;
}

async function serializable(transaction) {
  try {
    return await prisma.$transaction(transaction, { isolationLevel: 'Serializable' });
  } catch (error) {
    if (error.code === 'P2034' || error.code === 'P2002' || error.code === 'P2003' || error.code === 'P2025') {
      throw new TelegramLinkError(409, 'Account data changed. Try again');
    }
    throw error;
  }
}

async function createTelegramLinkCode(userId, password) {
  const verified = await passwordAccount(userId, password);
  if (verified.telegramId) throw new TelegramLinkError(409, 'Telegram is already linked');
  const code = randomBytes(18).toString('base64url');
  const codeHash = hashCode(code);
  const expiresAt = new Date(Date.now() + LINK_LIFETIME_MS);

  await serializable(async (tx) => {
    const account = await tx.user.findUnique({ where: { id: userId }, select: linkableFields });
    if (!account || account.password !== verified.password || account.telegramId) {
      throw new TelegramLinkError(409, 'Account data changed. Try again');
    }
    await tx.telegramLinkCode.upsert({
      where: { userId },
      create: { userId, codeHash, expiresAt },
      update: { codeHash, expiresAt },
    });
  });
  return { code, expiresAt };
}

async function linkAccounts(db, codeHash, telegramId, now) {
  const link = await db.telegramLinkCode.findUnique({
    where: { codeHash },
    select: { user: { select: linkableFields }, expiresAt: true },
  });
  if (!link || link.expiresAt <= now) throw expiredLink();
  const target = link.user;
  if (!target.username || !target.password || target.telegramId) throw expiredLink();
  const duplicate = await db.user.findUnique({ where: { telegramId }, select: linkableFields });
  if (duplicate && duplicate.id === target.id) {
    throw new TelegramLinkError(409, 'Telegram is already linked to this account');
  }
  if (duplicate && (duplicate.isAdmin || target.isAdmin)) {
    throw new TelegramLinkError(409, 'This Telegram account cannot be merged');
  }
  return { target, duplicate };
}

async function previewTelegramLink(code, telegramId) {
  const { target, duplicate } = await linkAccounts(prisma, hashCode(code), telegramId, new Date());
  return { username: target.username, mergeRequired: Boolean(duplicate) };
}

async function moveAccountData(tx, from, to) {
  const favorites = await tx.favorite.findMany({
    where: { userId: from },
    select: { trackId: true, createdAt: true, updatedAt: true },
  });
  if (favorites.length) {
    await tx.favorite.createMany({ data: favorites.map((favorite) => ({ ...favorite, userId: to })), skipDuplicates: true });
    await tx.favorite.deleteMany({ where: { userId: from } });
  }
  await tx.review.updateMany({ where: { userId: from }, data: { userId: to } });
  await tx.complaint.updateMany({ where: { userId: from }, data: { userId: to } });
  await tx.playbackDevice.deleteMany({ where: { userId: from } });
  await tx.playbackSession.deleteMany({ where: { userId: from } });
}

async function confirmTelegramLink(code, identity, confirmMerge) {
  const codeHash = hashCode(code);
  const result = await serializable(async (tx) => {
    const now = new Date();
    const { target, duplicate } = await linkAccounts(tx, codeHash, identity.telegramId, now);
    if (duplicate && !confirmMerge) throw new TelegramLinkError(409, 'Confirm the account merge');
    const consumed = await tx.telegramLinkCode.deleteMany({
      where: { userId: target.id, codeHash, expiresAt: { gt: now } },
    });
    if (consumed.count !== 1) throw expiredLink();

    const profileImageUrl = target.profileImageUrl ?? duplicate?.profileImageUrl ?? null;
    if (duplicate) {
      await moveAccountData(tx, duplicate.id, target.id);
      await tx.user.delete({ where: { id: duplicate.id } });
    }
    const user = await tx.user.update({
      where: { id: target.id },
      data: { ...identity, profileImageUrl, telegramAuthVersion: { increment: 1 } },
      select: { id: true, isAdmin: true, telegramId: true, telegramAuthVersion: true },
    });
    return { user, unusedAvatar: duplicate?.profileImageUrl !== profileImageUrl ? duplicate : null };
  });
  if (result.unusedAvatar) await cleanupUserAvatar(result.unusedAvatar.id, result.unusedAvatar.profileImageUrl);
  return result.user;
}

async function unlinkTelegram(userId, password) {
  const verified = await passwordAccount(userId, password);
  if (!verified.telegramId) throw new TelegramLinkError(409, 'Telegram is not linked');
  return serializable(async (tx) => {
    const user = await tx.user.update({
      where: {
        id: userId,
        password: verified.password,
        telegramId: verified.telegramId,
        telegramAuthVersion: verified.telegramAuthVersion,
      },
      data: {
        telegramId: null, telegramName: null, telegramUsername: null, telegramPhotoUrl: null,
        telegramAuthVersion: { increment: 1 },
      },
      select: { id: true, isAdmin: true },
    });
    await tx.telegramLinkCode.deleteMany({ where: { userId } });
    return user;
  });
}

module.exports = {
  TelegramLinkError, createTelegramLinkCode, previewTelegramLink, confirmTelegramLink, unlinkTelegram,
};
