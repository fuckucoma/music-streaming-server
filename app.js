require('dotenv').config();

const express = require('express');
const app = express();
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const path = require('path');
const fs = require('fs');
const multer = require('multer')

app.use(express.json());

app.use('/images', express.static(path.join(__dirname, 'public', 'images')));
app.use('/tracks', express.static(path.join(__dirname, 'public', 'tracks')));

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadPath = file.fieldname === 'image' ? './public/images/' : './public/tracks/';
    cb(null, uploadPath);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({ storage });

// Маршрут для добавления трека с изображением и аудиофайлом
app.post('/add-track', upload.fields([{ name: 'image', maxCount: 1 }, { name: 'track', maxCount: 1 }]), async (req, res) => {
  try {
    const { title, artist } = req.body;
    const imageFile = req.files['image'] ? req.files['image'][0] : null;
    const audioFile = req.files['track'] ? req.files['track'][0] : null;

    if (!imageFile || !audioFile) {
      return res.status(400).json({ error: 'Необходимы и изображение, и аудиофайл' });
    }

    // Пути к файлам для сохранения в базе данных
    const imageUrl = `/images/${imageFile.filename}`;
    const audioUrl = `${audioFile.filename}`;

    // Сохранение данных о треке в базе данных через Prisma
    const track = await prisma.track.create({
      data: {
        title: title,
        artist: artist,
        imageUrl: imageUrl,
        filename: audioUrl,
        createdAt: new Date()
      }
    });

    res.status(201).json({ message: 'Трек успешно загружен и добавлен в базу данных', track });
  } catch (error) {
    console.error('Ошибка при добавлении трека:', error.message);
    res.status(500).json({ error: 'Ошибка при добавлении трека' });
  }
});

// Маршрут для поиска треков по названию или исполнителю
app.get('/search-tracks', async (req, res) => {
  try {
    const { query } = req.query;

    if (!query) {
      console.log('Параметр запроса отсутствует');
      return res.status(400).json({ error: 'Необходим параметр запроса' });
    }

    console.log(`Ищем треки с параметром запроса: ${query}`);

    const tracks = await prisma.track.findMany({
      where: {
        OR: [
          {
            title: {
              contains: query,
            }
          },
          {
            artist: {
              contains: query,
            }
          }
        ]
      }
    });

    const baseUrl = process.env.BASE_URL || 'http://localhost:3000';
    const tracksWithFullUrl = tracks.map(track => ({
      ...track,
      imageUrl: track.imageUrl ? `${baseUrl}${track.imageUrl}` : null,
      filename: track.filename.replace(/^\/tracks\//, '')
    }));

    console.log(`Найдено треков: ${tracksWithFullUrl.length}`);
    res.json(tracksWithFullUrl);
  } catch (error) {
    console.error('Ошибка при поиске треков:', error.message);
    res.status(500).json({ error: 'Ошибка при поиске треков' });
  }
});





app.delete('/delete/tracks/:id', async (req, res) => {
  try {
    const trackId = parseInt(req.params.id);

    // Найдите трек в базе данных
    const track = await prisma.track.findUnique({
      where: { id: trackId }
    });

    if (!track) {
      return res.status(404).json({ error: 'Трек не найден' });
    }

    // Удаление записи из базы данных
    await prisma.track.delete({
      where: { id: trackId }
    });

    // Удаление связанных файлов
    const imagePath = path.join(__dirname, 'public', track.imageUrl);
    const audioPath = path.join(__dirname, 'public', track.filename);

    if (fs.existsSync(imagePath)) {
      fs.unlinkSync(imagePath);
    }
    if (fs.existsSync(audioPath)) {
      fs.unlinkSync(audioPath);
    }

    res.status(200).json({ message: 'Трек и его файлы успешно удалены' });
  } catch (error) {
    console.error('Ошибка при удалении трека:', error.message);
    res.status(500).json({ error: 'Ошибка при удалении трека' });
  }
});


// Маршрут для получения списка треков
app.get('/tracks', async (req, res) => {
  try {
    const tracks = await prisma.track.findMany();
    const baseUrl = process.env.BASE_URL || 'http://localhost:3000';
    const tracksWithFullUrl = tracks.map(track => ({
      ...track,
      imageUrl: `${baseUrl}${track.imageUrl}`,
      filename: track.filename.replace(/^\/tracks\//, '')
    }));
    
    // Логируем URL для проверки
    console.log("Полный URL для треков и изображений:", tracksWithFullUrl);

    res.json(tracksWithFullUrl);
  } catch (error) {
    console.error('Ошибка при получении треков:', error.message);
    res.status(500).json({ error: 'Ошибка при получении треков' });
  }
});

// Маршрут для стриминга трека
app.get('/tracks/:id/stream', async (req, res) => {
  try {
    const trackId = parseInt(req.params.id);
    const track = await prisma.track.findUnique({
      where: { id: trackId },
    });

    if (!track) {
      return res.status(404).json({ error: 'Трек не найден.' });
    }

    const filePath = path.join(__dirname, 'public', 'tracks', track.filename.replace(/^\/tracks\//, ''));

    const stat = fs.statSync(filePath);
    const fileSize = stat.size;
    const range = req.headers.range;

    if (range) {
      // Частичный контент
      const parts = range.replace(/bytes=/, '').split('-');
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;

      if (start >= fileSize) {
        res.status(416).send('Запрашиваемый диапазон не достижим');
        return;
      }

      const chunksize = end - start + 1;
      const file = fs.createReadStream(filePath, { start, end });
      const head = {
        'Content-Range': `bytes ${start}-${end}/${fileSize}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': chunksize,
        'Content-Type': 'audio/mpeg',
      };

      res.writeHead(206, head);
      file.pipe(res);
    } else {
      // Полный контент
      const head = {
        'Content-Length': fileSize,
        'Content-Type': 'audio/mpeg',
      };

      res.writeHead(200, head);
      fs.createReadStream(filePath).pipe(res);
    }
  } catch (error) {
    console.error('Ошибка при стриминге трека:', error);
    res.status(500).json({ error: 'Ошибка при стриминге трека.' });
  }
});

// Запуск сервера
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Сервер запущен на порту ${PORT}`);
});
