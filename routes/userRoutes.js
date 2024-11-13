const express = require('express');
const router = express.Router();
const userController = require('../controllers/userController');
const jwt = require('jsonwebtoken');

const { uploadAvatar } = require('../middlewares/upload');

const JWT_SECRET = process.env.JWT_SECRET || '906063f946abce0013626fb0a2737d3bdb263a3b7f264bd68283108a836c73a1'; 

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
  router.get('/all', userController.getAllUsers);
  router.delete('/delete/:id', userController.deleteUser);

  module.exports = router
  
  return router;
