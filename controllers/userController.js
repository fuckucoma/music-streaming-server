const { PrismaClient } = require('@prisma/client')
const { PrismaClientKnownRequestError } = require('@prisma/client');;
require('dotenv').config();
const prisma = new PrismaClient();
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const JWT_SECRET = process.env.JWT_SECRET;
const JWT_EXPIRES_IN = '12h';

const supabase = require('../lib/supabase');
const SUPABASE_URL = process.env.SUPABASE_URL;

const SALT_ROUNDS = 10;


exports.edit_pass = async (req, res) => {
  const { currentPassword, newPassword } = req.body;

  if (!currentPassword || !newPassword) {
    return res.status(400).json({ error: 'Необходимы текущий и новый пароль' });
  }

  try {
    
    const user = await prisma.user.findUnique({ where: { id: req.user.userId } });

    if (!user) {
      return res.status(404).json({ error: 'Пользователь не найден' });
    }

    // Проверка текущего пароля
    const isPasswordValid = await bcrypt.compare(currentPassword, user.password);
    if (!isPasswordValid) {
      return res.status(401).json({ error: 'Текущий пароль неверен' });
    }

    // Хеширование нового пароля
    const hashedPassword = await bcrypt.hash(newPassword, SALT_ROUNDS);

    // Обновление пароля в базе данных
    await prisma.user.update({
      where: { id: user.id },
      data: { password: hashedPassword },
    });

    res.status(200).json({ message: 'Пароль успешно изменен' });
  } catch (error) {
    console.error('Error changing password:', error);
    res.status(500).json({ error: 'Ошибка при изменении пароля' });
  }
};

exports.edit_username = async (req, res) => {
  const { newUsername } = req.body;

  if (!newUsername) {
    return res.status(400).json({ error: 'Новое имя пользователя обязательно' });
  }

  try {
    // Проверка, что новое имя пользователя не занято
    const existingUser = await prisma.user.findUnique({ where: { username: newUsername } });
    if (existingUser) {
      return res.status(400).json({ error: 'Имя пользователя уже занято' });
    }

    // Обновление имени пользователя в базе данных
    const updatedUser = await prisma.user.update({
      where: { id: req.user.userId },
      data: { username: newUsername },
    });

    res.status(200).json({ message: 'Имя пользователя успешно изменено', username: updatedUser.username });
  } catch (error) {
    console.error('Error changing username:', error);
    res.status(500).json({ error: 'Ошибка при изменении имени пользователя' });
  }
};


exports.register = async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'username and password required' });
  try {
    const existing = await prisma.user.findUnique({ where: { username } });
    if (existing) return res.status(400).json({ error: 'Username already taken' });
 
    const hashed  = await bcrypt.hash(password, SALT_ROUNDS);
    const newUser = await prisma.user.create({ data: { username, password: hashed } });
    const token   = jwt.sign({ userId: newUser.id }, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
    res.status(201).json({ message: 'Registered', userId: newUser.id, token });
  } catch (err) {
    console.error('register:', err);
    res.status(500).json({ error: 'Registration failed' });
  }
};

exports.login = async (req, res) => {
  const { username, password } = req.body;
  console.log(`[Login] attempt: ${username}`);
  try {
    const user = await prisma.user.findUnique({ where: { username } });
    if (!user) return res.status(401).json({ error: 'Invalid credentials' });
    if (!user.password) return res.status(401).json({ error: 'This account uses Telegram login' });
 
    const valid = await bcrypt.compare(password, user.password);
    if (!valid) return res.status(401).json({ error: 'Invalid credentials' });
 
    const token = jwt.sign(
      { userId: user.id, isAdmin: user.isAdmin },
      JWT_SECRET,
      { expiresIn: JWT_EXPIRES_IN },
    );
    console.log(`[Login] success: ${username}`);
    res.json({ message: 'Logged in', token, admin: user.isAdmin });
  } catch (err) {
    console.error('login:', err);
    res.status(500).json({ error: 'Login failed' });
  }
};

//exports.logout = (req, res) => {
//  req.session.destroy((err) => {
//      if (err) {
//      return res.status(500).json({ error: 'Ошибка выхода' });
//      }
//res.status(200).json({ message: 'Выход выполнен' });
//  });
//};

exports.logout = (req, res) => {
  // Sessions are disabled — JWT is stateless, just return success
  res.status(200).json({ message: 'Выход выполнен' });
};

exports.uploadProfileImage = async (req, res) => {
   const user = await prisma.user.findUnique({
    where:{
       id:req.user.userId
    }
 })
 
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const userId  = decoded.userId;
 
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
 
    const ext         = req.file.mimetype.includes('png') ? 'png' : 'jpg';
    const storagePath = `avatars/${userId}_${Date.now()}.${ext}`;
 
    // Upload to Supabase
    const { error } = await supabase.storage
      .from('images')
      .upload(storagePath, req.file.buffer, { contentType: req.file.mimetype, upsert: true });
    if (error) throw new Error(error.message);
 
    const profileImageUrl = `${SUPABASE_URL}/storage/v1/object/public/images/${storagePath}`;
 
    // Delete old avatar from Supabase if it exists
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (user?.profileImageUrl?.includes('/storage/v1/object/public/images/')) {
      const oldPath = user.profileImageUrl.split('/storage/v1/object/public/images/')[1];
      if (oldPath) await supabase.storage.from('images').remove([oldPath]).catch(() => {});
    }
 
    await prisma.user.update({ where: { id: userId }, data: { profileImageUrl } });
 
    res.status(200).json({ message: 'Profile image updated', profileImageUrl });
  } catch (error) {
    console.error('uploadProfileImage error:', error);
    res.status(500).json({ error: 'Failed to update profile image' });
  }
};

exports.getAllUsers = async (req, res) => {
  if (!req.user?.isAdmin) return res.status(403).json({ error: 'Forbidden' });
  try {
    const users = await prisma.user.findMany({
      select: { id: true, username: true, telegramName: true, profileImageUrl: true, createdAt: true },
    });
    res.json({ users });
  } catch (err) {
    console.error('getAllUsers:', err);
    res.status(500).json({ error: 'Failed to get users' });
  }
};

exports.deleteUser = async (req, res) => {
  try {
    const { id } = req.params; 

    if (!req.user.isAdmin) {
      return res.status(403).json({ error: 'Доступ запрещен' });
    }

    const user = await prisma.user.findUnique({
      where: { id: parseInt(id) }
    });

    if (!user) {
      return res.status(404).json({ error: 'Пользователь не найден' });
    }


    if (user.profileImageUrl) {
      const profileImagePath = path.join(__dirname, '..', 'public', user.profileImageUrl);

      if (fs.existsSync(profileImagePath)) {
        fs.unlinkSync(profileImagePath); 
      }
    }

    await prisma.user.delete({
      where: { id: parseInt(id) }
    });

    res.status(200).json({ message: 'Пользователь и все связанные данные успешно удалены' });
  } catch (error) {
    console.error('Ошибка при удалении пользователя:', error);
    res.status(500).json({ error: 'Ошибка при удалении пользователя' });
  }
};

exports.getUserProfile = async (req, res) => {
   const user = await prisma.user.findUnique({
    where:{
       id:req.user.userId
    }
 })
 
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const user    = await prisma.user.findUnique({
      where:  { id: decoded.userId },
      select: {
        id: true,
        username: true,
        telegramName: true,
        telegramId: true,
        profileImageUrl: true,
        isAdmin: true,
        createdAt: true,
        updatedAt: true,
      },
    });
    if (!user) return res.status(404).json({ error: 'User not found' });
 
    // Return the best display name available
    res.json({
      ...user,
      displayName: user.telegramName ?? user.username ?? `User#${user.id}`,
    });
  } catch (err) {
    console.error('getUserProfile:', err);
    res.status(500).json({ error: 'Failed to get profile' });
  }
};

exports.getUserById = async (req, res) => {

   const user = await prisma.user.findUnique({
    where:{
       id:req.user.userId
    }
 })

  try {
    jwt.verify(token, JWT_SECRET); // just validate
    const id   = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: 'Invalid ID' });
    const user = await prisma.user.findUnique({
      where:  { id },
      select: { id: true, username: true, telegramName: true, profileImageUrl: true, createdAt: true },
    });
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json(user);
  } catch (err) {
    if (err instanceof jwt.JsonWebTokenError) return res.status(401).json({ error: 'Invalid token' });
    res.status(500).json({ error: 'Server error' });
  }
};