const express = require('express');
const controller = require('../controllers/favoriteController');
const { authenticateToken } = require('../middlewares/auth');

const router = express.Router();
const handle = (action) => (req, res, next) => action(req, res).catch(next);

router.post('/add', authenticateToken, handle(controller.addFavorite));
router.get('/get', authenticateToken, handle(controller.getFavorites));
router.post('/remove', authenticateToken, handle(controller.removeFavorite));

module.exports = router;
