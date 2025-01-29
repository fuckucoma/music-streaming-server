const express = require('express');
const router = express.Router();
const reviewController = require('../controllers/reviewController');
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

router.post('/create', authenticateToken, reviewController.createReview);

router.get('/all', authenticateToken, reviewController.getAllReviews);

router.delete('/delete/:id', authenticateToken, reviewController.deleteReview);

router.get('/track/:trackId', authenticateToken, reviewController.getReviewsForTrack);

module.exports = router;
