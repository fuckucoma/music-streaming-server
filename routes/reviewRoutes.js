const express = require('express');
const router = express.Router();
const reviewController = require('../controllers/reviewController');
const { authenticateToken } = require('../middlewares/authenticate');

// POST: Создать отзыв
router.post('/create', authenticateToken, reviewController.createReview);

// GET: Получить все отзывы (админ)
router.get('/all', authenticateToken, reviewController.getAllReviews);

// DELETE: Удалить отзыв
router.delete('/delete/:id', authenticateToken, reviewController.deleteReview);

module.exports = router;
