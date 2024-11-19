const express = require('express');
const router = express.Router();
require('dotenv').config();
const trackController = require('../controllers/trackController');
const { upload } = require('../middlewares/upload');

router.get('/', trackController.getTracks); 
router.post('/add-track', upload.fields([{ name: 'image', maxCount: 1 }, { name: 'track', maxCount: 1 }]), trackController.addTrack); 
router.get('/:id/stream', trackController.streamTrack); 
router.delete('/delete/:id', trackController.deleteTrack); 
router.get('/search', trackController.search);
router.post('/upload-multiple', upload.array('tracks'), trackController.uploadMultipleTracks);

module.exports = router;