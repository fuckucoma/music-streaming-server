require('dotenv').config();

const express = require('express');
const app = express();
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const path = require('path');
const fs = require('fs');

app.use(express.json());

// Маршрут для получения списка треков
app.get('/tracks', async (req, res) => {
  try {
    const tracks = await prisma.track.findMany();
    res.json(tracks);
  } catch (error) {
    res.status(500).json({ error: 'Ошибка при получении списка треков.' });
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

    const filePath = path.join(__dirname, 'tracks', track.filename);
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
