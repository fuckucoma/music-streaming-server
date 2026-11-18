const express = require('express');
const complaintController = require('../controllers/complaintController');
const { authenticateToken, requireAdmin } = require('../middlewares/auth');

const router = express.Router();
router.use(authenticateToken);
router.post('/create', complaintController.createComplaint);
router.get('/all', requireAdmin, complaintController.getAllComplaints);
router.put('/update/:id', requireAdmin, complaintController.updateComplaint);

module.exports = router;
