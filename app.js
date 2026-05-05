require('dotenv').config();
const express = require('express');
const session = require('express-session');
const cors = require('cors');
const morgan = require('morgan');
const path = require('path');
const exp = require('constants');

const complaintRouter = require('./routes/complaintRoutes');
const reviewRouter = require('./routes/reviewRoutes');
const adminRouter = require('./routes/adminRoutes');
const app = express();

const corsOptions = {
  origin: (origin, callback) => {
    // Allow requests with no origin (mobile apps, Postman, curl)
    if (!origin) return callback(null, true);

    const allowed = [
      'https://underlab-phi.vercel.app',
      'http://localhost:5173',
    ];

    // Allow the fixed domain OR any Vercel preview for your project
    if (allowed.includes(origin) || origin.endsWith('.vercel.app')) {
      callback(null, true);
    } else {
      callback(new Error(`CORS blocked: ${origin}`));
    }
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Range', 'Authorization'],
  exposedHeaders: ['Content-Range', 'Accept-Ranges', 'Content-Length'],
};

app.use(cors(corsOptions));
app.options('*', cors(corsOptions));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(morgan('combined'));

app.use((req, res, next) => {
  console.log(`Получен запрос на ${req.url}`);
  next();
});

//app.use(session({
  //secret: process.env.SESSION_SECRET,
  //resave: false,
  //saveUninitialized: false,
  //cookie: { secure: false }
//}));

app.use('/images', express.static(path.join(__dirname, 'public', 'images')));
app.use('/tracks', express.static(path.join(__dirname, 'public', 'tracks')));
app.use('/avatars', express.static(path.join(__dirname, 'public','avatars')));

app.use('/users', require('./routes/userRoutes'));
app.use('/tracks', require('./routes/trackRoutes'));
app.use('/favorites', require('./routes/favoriteRoutes'));
app.use('/complaints', complaintRouter);
app.use('/reviews', reviewRouter);
app.use('/api/admin', adminRouter);



const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`Сервер запущен на порту ${PORT}`);
});
