const express = require('express');
const authController = require('../controllers/authController');
const { authenticateToken } = require('../middlewares/auth');
const { limitCredentialAttempts } = require('../middlewares/authRateLimit');

const router = express.Router();
router.post('/telegram', limitCredentialAttempts, authController.telegramAuth);
router.post('/telegram/link-code', authenticateToken, limitCredentialAttempts, authController.createLinkCode);
router.post('/telegram/link/preview', limitCredentialAttempts, authController.previewLink);
router.post('/telegram/link', limitCredentialAttempts, authController.confirmLink);
router.delete('/telegram/link', authenticateToken, limitCredentialAttempts, authController.unlinkTelegram);

module.exports = router;
