const express = require('express');
const router = express.Router();
const trackController = require('../controllers/trackController');
const upload = require('../middlewares/upload'); // Middleware для загрузки файлов

// Маршруты для треков
router.get('/', trackController.getTracks); // Получение списка треков
router.post('/add-track', upload.fields([{ name: 'image', maxCount: 1 }, { name: 'track', maxCount: 1 }]), trackController.addTrack); // Добавление трека
router.get('/:id/stream', trackController.streamTrack); // Стриминг трека
router.delete('/delete/:id', trackController.deleteTrack); // Удаление трека
router.get('/search', trackController.search);

module.exports = router;