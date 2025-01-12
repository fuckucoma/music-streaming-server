const express = require('express');
const router = express.Router();
const reviewController = require('../controllers/reviewController');

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

// POST: Создать отзыв
router.post('/create', authenticateToken, reviewController.createReview);

// GET: Получить все отзывы (админ)
router.get('/all', authenticateToken, reviewController.getAllReviews);

// DELETE: Удалить отзыв
router.delete('/delete/:id', authenticateToken, reviewController.deleteReview);

module.exports = router;
