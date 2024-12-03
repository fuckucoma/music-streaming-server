const express = require('express');
const router = express.Router();
require('dotenv').config();
const userController = require('../controllers/userController');
const jwt = require('jsonwebtoken');

const { uploadAvatar } = require('../middlewares/upload');

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

  router.post('/register', userController.register);
  router.post('/login', userController.login);
  router.post('/logout', userController.logout);
  router.post('/uploadProfileImage', authenticateToken, uploadAvatar.single('profileImage'), userController.uploadProfileImage);
  router.get('/profile', authenticateToken, userController.getUserProfile);
  router.get('/all', authenticateToken, userController.getAllUsers);
  router.delete('/delete/:id', authenticateToken, userController.deleteUser);

  module.exports = router
  
  return router;
