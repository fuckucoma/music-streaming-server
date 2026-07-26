const express        = require('express');
const router         = express.Router();
const authController = require('../controllers/authController');

// POST /auth/telegram
router.post('/telegram', authController.telegramAuth);

module.exports = router;