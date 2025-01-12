const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../middlewares/authenticate');
const adminController = require('../controllers/adminController.js');

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
