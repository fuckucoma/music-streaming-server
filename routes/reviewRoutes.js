const express = require('express');
const reviewController = require('../controllers/reviewController');
const { authenticateToken, requireAdmin } = require('../middlewares/auth');

const router = express.Router();
router.use(authenticateToken);
router.post('/create', reviewController.createReview);
router.get('/all', requireAdmin, reviewController.getAllReviews);
router.delete('/delete/:id', requireAdmin, reviewController.deleteReview);
router.delete('/delete_user_review/:id', reviewController.deleteUserReview);
router.get('/track/:trackId', reviewController.getReviewsForTrack);

module.exports = router;
