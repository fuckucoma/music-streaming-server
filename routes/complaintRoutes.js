const express = require('express');
const router = express.Router();
const complaintController = require('../controllers/complaintController');
const { authenticateToken } = require('../middlewares/authenticate');

// POST: Создать жалобу
router.post('/create', authenticateToken, complaintController.createComplaint);

// GET: Получить все жалобы (только для админа)
router.get('/all', authenticateToken, complaintController.getAllComplaints);

// PUT: Обновить статус жалобы (только для админа)
router.put('/update/:id', authenticateToken, complaintController.updateComplaint);

module.exports = router;
