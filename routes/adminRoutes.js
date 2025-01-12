const express = require('express');
const router = express.Router();
const adminController = require('../controllers/adminController.js');
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET; 
console.log('JWT_SECRET:', process.env.JWT_SECRET);

const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1]; 

  if (!token) {
    return res.sendStatus(401); 
  }

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) {
      return res.sendStatus(403); 
    }
    req.user = user; 
    next();
  });
};

// Получить сводку данных для панели администратора
router.get('/dashboard', authenticateToken, adminController.getDashboardData);

// Получить список пользователей
router.get('/users', authenticateToken, adminController.getAllUsers);

// Удалить пользователя
router.delete('/users/:id', authenticateToken, adminController.deleteUser);

// Получить список жалоб
router.get('/complaints', authenticateToken, adminController.getAllComplaints);

// Обновить статус жалобы
router.put('/complaints/:id', authenticateToken, adminController.updateComplaint);

// Получить список отзывов
router.get('/reviews', authenticateToken, adminController.getAllReviews);

// Удалить отзыв
router.delete('/reviews/:id', authenticateToken, adminController.deleteReview);

// Управление треками
router.put('/tracks/:id', authenticateToken, adminController.editTrack);
router.delete('/tracks/:id', authenticateToken, adminController.deleteTrack);

module.exports = router;
