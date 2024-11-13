const express = require('express');
const router = express.Router();
const favoriteController = require('../controllers/favoriteController');
const { authenticateToken } = favoriteController;

router.post('/favorites', authenticateToken, favoriteController.addFavorite);

router.get('/favorites', authenticateToken, favoriteController.getFavorites);

module.exports = router;

module.exports = router;
