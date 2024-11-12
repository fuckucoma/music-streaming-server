const express = require('express');
const router = express.Router();
const favoriteController = require('../controllers/favoriteController');

router.post('/favorites', favoriteController.addFavorite);
router.get('/favorites', favoriteController.getFavorites);

module.exports = router;
