const express = require('express');
const trackController = require('../controllers/trackController');
const { authenticateToken, requireAdmin } = require('../middlewares/auth');
const { upload, withTrackUpload } = require('../middlewares/upload');
const { MAX_TRACKS } = require('../services/tracks');

const router = express.Router();
const adminOnly = [authenticateToken, requireAdmin];

router.get('/', trackController.getTracks);
router.get('/search', trackController.search);
router.get('/by-ids', trackController.getTracksByIds);
router.get('/:id/stream', trackController.streamTrack);

router.post(
  '/add-track',
  adminOnly,
  withTrackUpload(
    upload.fields([{ name: 'image', maxCount: 1 }, { name: 'track', maxCount: 1 }]),
    trackController.addTrack,
  ),
);
router.post(
  '/upload-multiple',
  adminOnly,
  withTrackUpload(upload.array('tracks', MAX_TRACKS), trackController.uploadMultipleTracks),
);
router.delete('/delete/:id', adminOnly, trackController.deleteTrack);
router.put('/edit/:id', adminOnly, trackController.editTrack);

module.exports = router;
