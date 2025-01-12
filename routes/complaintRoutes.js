const express = require('express');
const router = express.Router();
const complaintController = require('../controllers/complaintController');
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

// POST: Создать жалобу
router.post('/create', authenticateToken, complaintController.createComplaint);

// GET: Получить все жалобы (только для админа)
router.get('/all', authenticateToken, complaintController.getAllComplaints);

// PUT: Обновить статус жалобы (только для админа)
router.put('/update/:id', authenticateToken, complaintController.updateComplaint);

module.exports = router;
