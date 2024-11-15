const express = require('express');
const router = express.Router();
const favoriteController = require('../controllers/favoriteController');
const { authenticateToken } = favoriteController;

router.post('/add', authenticateToken, favoriteController.addFavorite);

router.get('/get', authenticateToken, favoriteController.getFavorites);

router.post('/remove', authenticateToken, favoriteController.removeFavorite);

module.exports = router;
