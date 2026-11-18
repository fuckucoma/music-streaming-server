const express = require('express');
const admin = require('../controllers/adminController');
const complaints = require('../controllers/complaintController');
const reviews = require('../controllers/reviewController');
const { authenticateToken, requireAdmin } = require('../middlewares/auth');

const router = express.Router();
router.use(authenticateToken, requireAdmin);

router.get('/dashboard', admin.getDashboardData);
router.get('/users', admin.getAllUsers);
router.delete('/users/:id', admin.deleteUser);
router.get('/complaints', complaints.getAllComplaints);
router.put('/complaints/:id', complaints.updateAdminComplaint);
router.get('/reviews', reviews.getAdminReviews);
router.delete('/reviews/:id', reviews.deleteReview);
router.put('/tracks/:id', admin.editTrack);
router.delete('/tracks/:id', admin.deleteTrack);

module.exports = router;
