const multer = require('multer');
const path = require('path');

// Настройка для загрузки треков и изображений треков
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    console.log('fieldname:', file.fieldname);
    if (file.fieldname === 'image') {
      cb(null, path.join(__dirname, '..', 'public', 'images'));
    } else if (file.fieldname === 'track'|| file.fieldname === 'tracks') {
      cb(null, path.join(__dirname, '..', 'public', 'tracks'));
    } else {
      cb(new Error('Некорректное поле для загрузки файла'));
    }
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  }
});

// Настройка для загрузки аватаров
const avatarStorage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, path.join(__dirname, '..', 'public', 'avatars')); // Папка для аватаров
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({ storage: storage });
const uploadAvatar = multer({ storage: avatarStorage }); // Загрузка только аватаров

module.exports = { upload, uploadAvatar };
