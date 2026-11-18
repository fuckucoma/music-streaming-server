const express = require('express');
const authController = require('../controllers/authController');
const { limitCredentialAttempts } = require('../middlewares/authRateLimit');

const router = express.Router();
router.post('/telegram', limitCredentialAttempts, authController.telegramAuth);

module.exports = router;
