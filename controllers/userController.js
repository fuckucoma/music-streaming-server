const { PrismaClient } = require('@prisma/client');
require('dotenv').config();
const prisma = new PrismaClient();
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcrypt');
const SALT_ROUNDS = 10;
const jwt = require('jsonwebtoken');
const JWT_SECRET = process.env.JWT_SECRET; // Используйте переменные окружения
const JWT_EXPIRES_IN = '12h';

exports.register = async (req, res) => {
  const { username, password } = req.body;

  try {
    const existingUser = await prisma.user.findUnique({ where: { username } });
    if (existingUser) {
      return res.status(400).json({ error: 'Имя пользователя уже занято' });
    }

    const hashedPassword = await bcrypt.hash(password, SALT_ROUNDS);

    const newUser = await prisma.user.create({ data: { username, password: hashedPassword } });

    // Создание JWT
    const token = jwt.sign({ userId: newUser.id }, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });

    res.status(201).json({ message: 'Пользователь зарегистрирован', userId: newUser.id, token });
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ error: 'Ошибка регистрации' });
  }
};

exports.login = async (req, res) => {
  const { username, password } = req.body;

  // Добавьте логирование для отладки
  console.log(`Login attempt for username: ${username}`+'  '+ `user file: ${username}` );

  try {
    const user = await prisma.user.findUnique({ where: { username } });
    if (!user) {
      console.log(`User not found: ${username}`);
      return res.status(401).json({ error: 'Неверные учетные данные' });
    }

    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      console.log(`Invalid password for user: ${username}`);
      return res.status(401).json({ error: 'Неверные учетные данные' });
    }

  
    const admin = user.isAdmin;
   
    
    const token = jwt.sign({ userId: user.id, isAdmin: user.isAdmin }, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });

    console.log(`User logged in successfully: ${username}`);
    res.status(200).json({ message: 'Вход выполнен успешно', token , admin});
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Ошибка входа' });
  }
};

exports.logout = (req, res) => {
  req.session.destroy((err) => {
      if (err) {
          return res.status(500).json({ error: 'Ошибка выхода' });
      }
      res.status(200).json({ message: 'Выход выполнен' });
  });
};

// Метод загрузки изображения профиля
exports.uploadProfileImage = async (req, res) => {
  const token = req.headers['authorization']?.split(' ')[1];
  if (!token) {
    return res.status(401).json({ error: 'Токен не предоставлен' });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const userId = decoded.userId;

    if (!req.file) {
      return res.status(400).json({ error: 'Файл не загружен' });
    }

    const profileImageUrl = `${req.protocol}://${req.get('host')}/avatars/${req.file.filename}`;

    const user = await prisma.user.findUnique({
      where: { id: userId }
    });

    if (user.profileImageUrl != null) {
      
      const oldProfileImageUrl = path.join(__dirname,  '..', 'public' , user.profileImageUrl);

      if (fs.existsSync(oldProfileImageUrl)) {
        try {
          fs.unlinkSync(oldProfileImageUrl);
          console.log('Старая фотография профиля успешно удалена:', oldProfileImageUrl);
        } catch (err) {
          console.error('Ошибка при удалении старой фотографии профиля:', err);
        }
      }
    }
      
    await prisma.user.update({
      where: { id: userId },
      data: { profileImageUrl}
    });

    console.log('Profile image updated for userId:', userId);
    res.status(200).json({ message: 'Изображение профиля обновлено', profileImageUrl });
  } catch (error) {
    console.error('Error updating profile image:', error);
    res.status(500).json({ error: 'Ошибка обновления изображения профиля' });
  }
};

exports.getAllUsers = async (req, res) => {
  try {

    if (!req.user.isAdmin) {
      return res.status(403).json({ error: 'Доступ запрещен' });
    }

      const users = await prisma.user.findMany({
          select: {
              id: true,
              username: true,
              profileImageUrl: true,
              createdAt: true,
              updatedAt: true
          }
      });
      res.status(200).json({ users });
  } catch (error) {
      console.error("Ошибка при получении списка пользователей:", error);
      res.status(500).json({ error: "Ошибка при получении списка пользователей" });
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
  const token = req.headers['authorization']?.split(' ')[1];
  if (!token) {
    return res.status(401).json({ error: 'Токен не предоставлен' });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const userId = decoded.userId;

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        username: true,
        profileImageUrl: true,
        createdAt: true,
        updatedAt: true
        //isAdmin:false
      }
    });

    if (!user) {
      return res.status(404).json({ error: 'Пользователь не найден' });
    }

    res.status(200).json(user);
  } catch (error) {
    console.error('Error fetching user profile:', error);
    res.status(500).json({ error: 'Ошибка получения профиля пользователя' });
  }
};
