const express = require('express');
const userController = require('../controllers/userController');
const { positiveInt } = require('../lib/validation');
const { authenticateToken, requireAdmin } = require('../middlewares/auth');
const { limitCredentialAttempts } = require('../middlewares/authRateLimit');
const { uploadAvatar } = require('../middlewares/upload');

const router = express.Router();

function requireSelfOrAdmin(req, res, next) {
  const id = positiveInt(req.params.id);
  if (!id) return res.status(400).json({ error: 'Invalid ID' });
  res.locals.targetUserId = id;
  return id === req.user.userId ? next() : requireAdmin(req, res, next);
}

router.post('/register', limitCredentialAttempts, userController.register);
router.post('/login', limitCredentialAttempts, userController.login);
router.post('/logout', authenticateToken, userController.logout);
router.get('/sessions', authenticateToken, userController.sessions);
router.delete('/sessions/:id', authenticateToken, userController.revokeSession);
router.put('/edit-pass', authenticateToken, limitCredentialAttempts, userController.edit_pass);
router.put('/edit-username', authenticateToken, userController.edit_username);
router.post('/uploadProfileImage', authenticateToken, uploadAvatar.single('profileImage'), userController.uploadProfileImage);
router.get('/profile', authenticateToken, userController.getUserProfile);
router.get('/all', authenticateToken, requireAdmin, userController.getAllUsers);
router.delete('/delete/:id', authenticateToken, requireAdmin, userController.deleteUser);
router.get('/users/:id', authenticateToken, requireSelfOrAdmin, userController.getUserById);

module.exports = router;
