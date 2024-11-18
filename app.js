require('dotenv').config();
const express = require('express');
const session = require('express-session');
const cors = require('cors');
const morgan = require('morgan');
const path = require('path');
const exp = require('constants');

const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(morgan('combined'));

app.use((req, res, next) => {
  console.log(`Получен запрос на ${req.url}`);
  next();
});

app.use(session({
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: { secure: false }
}));


app.use('/images', express.static(path.join(__dirname, 'public', 'images')));
app.use('/tracks', express.static(path.join(__dirname, 'public', 'tracks')));
app.use('/avatars', express.static(path.join(__dirname, 'public','avatars')));

app.use('/users', require('./routes/userRoutes'));
app.use('/tracks', require('./routes/trackRoutes'));
app.use('/favorites', require('./routes/favoriteRoutes'));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Сервер запущен на порту ${PORT}`);
});
