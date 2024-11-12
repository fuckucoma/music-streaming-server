require('dotenv').config();
const express = require('express');
const session = require('express-session');
const cors = require('cors');
const multer = require('multer');
const morgan = require('morgan');
const path = require('path');
const exp = require('constants');

const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(morgan('combined'));


const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, 'upload/'); // Папка для хранения загруженных файлов
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({ storage: storage });

app.use(cors({
  origin: 'http://192.168.100.2:3000', // Замените на адрес вашего клиента
  credentials: true 
}));

app.use(session({
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: { secure: false }
}));

// Static folders
app.use('/images', express.static(path.join(__dirname, 'public', 'images')));
app.use('/tracks', express.static(path.join(__dirname, 'public', 'tracks')));
app.use('/upload', express.static(path.join(__dirname, 'upload')));


// Routes
app.use('/users', require('./routes/userRoutes')(upload));
app.use('/tracks', require('./routes/trackRoutes'));
app.use('/favorites', require('./routes/favoriteRoutes'));

// Запуск сервера
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Сервер запущен на порту ${PORT}`);
});
