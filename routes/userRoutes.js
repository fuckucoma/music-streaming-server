const express = require('express');
const router = express.Router();
const userController = require('../controllers/userController');
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || '906063f946abce0013626fb0a2737d3bdb263a3b7f264bd68283108a836c73a1'; // Используйте переменные окружения

const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1]; // Получение токена из заголовка

  if (!token) {
    return res.sendStatus(401); // Не авторизован
  }

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) {
      return res.sendStatus(403); // Запрещено
    }
    req.user = user; // Добавляем информацию о пользователе в запрос
    next();
  });
};

module.exports = (upload) => {
  router.post('/register', userController.register);
  router.post('/login', userController.login);
  router.post('/logout', userController.logout);
  router.post('/uploadProfileImage', authenticateToken, upload.single('profileImage'), userController.uploadProfileImage);
  router.get('/profile', authenticateToken, userController.getUserProfile);
  router.get('/all', userController.getAllUsers);

  return router;
  };
