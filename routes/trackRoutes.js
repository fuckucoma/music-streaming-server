const express = require('express');
const router = express.Router();
require('dotenv').config();
const trackController = require('../controllers/trackController');
const { upload } = require('../middlewares/upload');
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

router.get('/', trackController.getTracks); 
router.post('/add-track', upload.fields([{ name: 'image', maxCount: 1 }, { name: 'track', maxCount: 1 }]), trackController.addTrack); 
router.get('/:id/stream', trackController.streamTrack); 
router.delete('/delete/:id', trackController.deleteTrack); 
router.get('/search', trackController.search);
router.post('/upload-multiple', upload.array('tracks'), trackController.uploadMultipleTracks);
router.put('/edit/:id', authenticateToken, trackController.editTrack);

module.exports = router;