const bcrypt = require('bcrypt');
const prisma = require('../lib/prisma');
const { positiveInt } = require('../lib/validation');
const { detectImageType } = require('../services/images');
const { issueToken } = require('../services/tokens');
const { deleteUserAccount, updateUserAvatar } = require('../services/userAccounts');

const SALT_ROUNDS = 10;
const DUMMY_HASH = '$2b$10$aRm61gwI7yrSl2dQhC9DAOwynHuw5p1eq0OrtxCr4ezoLFTGz5SpC';
const publicUserFields = {
  id: true,
  username: true,
  telegramName: true,
  profileImageUrl: true,
  createdAt: true,
};

function newUsername(value) {
  if (typeof value !== 'string') return null;
  const username = value.trim();
  return username.length >= 1 && username.length <= 64 && !/[\0-\x1f\x7f]/.test(username) ? username : null;
}

function isNewPassword(password) {
  return typeof password === 'string' && password.length >= 8 && Buffer.byteLength(password) <= 72 &&
    !password.includes('\0');
}

function isExistingPassword(password) {
  return typeof password === 'string' && password.length > 0 && Buffer.byteLength(password) <= 1024;
}

exports.register = async (req, res, next) => {
  const { username, password } = req.body ?? {};
  const normalizedUsername = newUsername(username);
  if (!normalizedUsername) return res.status(400).json({ error: 'Username must be 1–64 characters' });
  if (!isNewPassword(password)) {
    return res.status(400).json({ error: 'Password must be at least 8 characters and at most 72 bytes' });
  }

  try {
    const hashed = await bcrypt.hash(password, SALT_ROUNDS);
    const user = await prisma.user.create({
      data: { username: normalizedUsername, password: hashed },
      select: { id: true, isAdmin: true },
    });
    return res.set('Cache-Control', 'no-store').status(201).json({ message: 'Registered', userId: user.id, token: issueToken(user) });
  } catch (error) {
    if (error.code === 'P2002') return res.status(400).json({ error: 'Username already taken' });
    next(error);
  }
};

exports.login = async (req, res, next) => {
  const { username, password } = req.body ?? {};
  if (typeof username !== 'string' || !username || username.length > 1024 || username.includes('\0') ||
      !isExistingPassword(password)) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  try {
    const select = { id: true, password: true, isAdmin: true };
    const normalizedUsername = username.trim();
    let user = await prisma.user.findUnique({ where: { username }, select });
    if (!user && normalizedUsername && normalizedUsername !== username) {
      user = await prisma.user.findUnique({ where: { username: normalizedUsername }, select });
    }
    const matches = await bcrypt.compare(password, user?.password ?? DUMMY_HASH);
    if (!user?.password || !matches) return res.status(401).json({ error: 'Invalid credentials' });
    return res.set('Cache-Control', 'no-store').json({ message: 'Logged in', token: issueToken(user), admin: user.isAdmin });
  } catch (error) {
    next(error);
  }
};

exports.logout = (req, res) => {
  // Bearer tokens are stateless. The client clears its session on logout.
  res.set('Cache-Control', 'no-store').json({ message: 'Выход выполнен' });
};

exports.edit_pass = async (req, res, next) => {
  const { currentPassword, newPassword } = req.body ?? {};
  if (!isExistingPassword(currentPassword) || !isNewPassword(newPassword)) {
    return res.status(400).json({ error: 'Укажите текущий пароль и новый пароль от 8 символов до 72 байт' });
  }

  try {
    const { userId } = req.user;
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { password: true } });
    if (!user) return res.status(404).json({ error: 'Пользователь не найден' });
    if (!user.password || !await bcrypt.compare(currentPassword, user.password)) {
      return res.status(401).json({ error: 'Текущий пароль неверен' });
    }

    const hashed = await bcrypt.hash(newPassword, SALT_ROUNDS);
    const { count } = await prisma.$transaction(async (tx) => {
      const result = await tx.user.updateMany({
        where: { id: userId, password: user.password },
        data: { password: hashed },
      });
      if (result.count) await tx.telegramLinkCode.deleteMany({ where: { userId } });
      return result;
    });
    if (!count) return res.status(409).json({ error: 'Пароль изменился. Повторите попытку.' });
    return res.json({ message: 'Пароль успешно изменен' });
  } catch (error) {
    next(error);
  }
};

exports.edit_username = async (req, res, next) => {
  const username = newUsername(req.body?.newUsername);
  if (!username) return res.status(400).json({ error: 'Имя пользователя должно содержать от 1 до 64 символов' });

  try {
    const user = await prisma.user.update({
      where: { id: req.user.userId },
      data: { username },
      select: { username: true },
    });
    return res.json({ message: 'Имя пользователя успешно изменено', username: user.username });
  } catch (error) {
    if (error.code === 'P2002') return res.status(400).json({ error: 'Имя пользователя уже занято' });
    if (error.code === 'P2025') return res.status(404).json({ error: 'Пользователь не найден' });
    next(error);
  }
};

exports.uploadProfileImage = async (req, res, next) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  const image = detectImageType(req.file.buffer);
  if (!image) return res.status(415).json({ error: 'Supported avatar formats are JPEG, PNG, GIF and WebP' });

  try {
    const result = await updateUserAvatar(req.user.userId, req.file.buffer, image);
    if (result.status === 'missing') return res.status(404).json({ error: 'User not found' });
    if (result.status === 'conflict') return res.status(409).json({ error: 'Profile changed. Try again.' });
    return res.json({ message: 'Profile image updated', profileImageUrl: result.profileImageUrl });
  } catch (error) {
    next(error);
  }
};

exports.getUserProfile = async (req, res, next) => {
  try {
    const account = await prisma.user.findUnique({
      where: { id: req.user.userId },
      select: { ...publicUserFields, telegramId: true, telegramPhotoUrl: true, isAdmin: true, updatedAt: true, password: true },
    });
    if (!account) return res.status(404).json({ error: 'User not found' });
    const { password, ...user } = account;
    return res.set('Cache-Control', 'no-store').json({
      ...user,
      hasPassword: Boolean(user.username && password),
      profileImageUrl: user.profileImageUrl ?? user.telegramPhotoUrl ?? null,
      displayName: user.telegramName ?? user.username ?? `User#${user.id}`,
    });
  } catch (error) {
    next(error);
  }
};

exports.getAllUsers = async (req, res, next) => {
  try {
    const users = await prisma.user.findMany({ select: publicUserFields });
    res.json({ users });
  } catch (error) {
    next(error);
  }
};

exports.getUserById = async (req, res, next) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: res.locals.targetUserId }, select: publicUserFields });
    if (!user) return res.status(404).json({ error: 'User not found' });
    return res.json(user);
  } catch (error) {
    next(error);
  }
};

exports.deleteUser = async (req, res, next) => {
  const id = positiveInt(req.params.id);
  if (!id) return res.status(400).json({ error: 'Invalid ID' });
  try {
    const deleted = await deleteUserAccount(id);
    if (!deleted) return res.status(404).json({ error: 'Пользователь не найден' });
    return res.json({ message: 'Пользователь и все связанные данные успешно удалены' });
  } catch (error) {
    if (error.code === 'P2003') return res.status(409).json({ error: 'Данные пользователя изменились. Повторите попытку.' });
    next(error);
  }
};
