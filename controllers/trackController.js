const { PrismaClient } = require('@prisma/client');
const path = require('path');
const fs = require('fs');
const prisma = new PrismaClient();

exports.addTrack = async (req, res) => { 
  try {
    const { title, artist } = req.body;
    const imageFile = req.files['image'] ? req.files['image'][0] : null;
    const audioFile = req.files['track'] ? req.files['track'][0] : null;

    if (!imageFile || !audioFile) {
      return res.status(400).json({ error: 'Необходимы и изображение, и аудиофайл' });
    }

    const imageUrl = imageFile.filename;
    const audioUrl = audioFile.filename;

    // Логируем данные перед сохранением
    console.log('Title:', title);
    console.log('Artist:', artist);
    console.log('Image URL:', imageUrl);
    console.log('Audio URL:', audioUrl);

    // Пытаемся сохранить данные в базу данныхo
    const track = await prisma.track.create({
      data: { title, artist, imageUrl, filename: audioUrl, createdAt: new Date() }
    });

    // Логируем успешный результат
    console.log('Track created:', track);

    res.status(201).json({ message: 'Трек успешно загружен и добавлен в базу данных', track });
  } catch (error) {
    console.error('Error during track upload:', error);  // Логируем подробную ошибку

    res.status(500).json({ error: 'Ошибка при добавлении трека' });
  }
};



exports.getTracks = async (req, res) => {
  try {
    const tracks = await prisma.track.findMany();
    const baseUrl = process.env.BASE_URL || 'http://localhost:3000';

    const tracksWithFullUrl = tracks.map(track => ({
      ...track,
      imageUrl: track.imageUrl ? `${baseUrl}/images/${track.imageUrl}` : null,
      filename: track.filename
    }));

    res.json(tracksWithFullUrl);
  } catch (error) {
    console.error('Ошибка при получении треков:', error.message);
    res.status(500).json({ error: 'Ошибка при получении треков' });
  }
};

exports.streamTrack = async (req, res) => {
  try {
    const trackId = parseInt(req.params.id);
    const track = await prisma.track.findUnique({
      where: { id: trackId },
    });

    if (!track) {
      return res.status(404).json({ error: 'Трек не найден.' });
    }

    const filePath = path.join(__dirname, '..', 'public', 'tracks', track.filename);

    console.log('Путь к файлу:', filePath);

    const stat = fs.statSync(filePath);
    const fileSize = stat.size;
    const range = req.headers.range;

    if (range) {
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
};


exports.search = async (req, res) => {
  try {
    const { query } = req.query;

    if (!query) {
      console.log('Параметр запроса отсутствует :', query);
      return res.status(400).json({ error: 'Необходим параметр запроса' });
    }

    const tracks = await prisma.track.findMany({
      where: {
        OR: [
          { title: { contains: query } },
          { artist: { contains: query } }
        ]
      }
    });

    const baseUrl = process.env.BASE_URL || 'http://localhost:3000';
    const tracksWithFullUrl = tracks.map(track => ({
      ...track,
      imageUrl: track.imageUrl ? `${baseUrl}/images/${track.imageUrl}` : null,
      filename: track.filename
    }));

    console.log('Найдено треков :', tracksWithFullUrl.length);
    res.json(tracksWithFullUrl);
  } catch (error) {
    console.error('Ошибка при поиске треков:', error.message);
    res.status(500).json({ error: 'Ошибка при поиске треков' });
  }
};

// Метод для удаления трека
exports.deleteTrack = async (req, res) => {
  try {
    const trackId = parseInt(req.params.id);

    const track = await prisma.track.findUnique({
      where: { id: trackId }
    });

    if (!track) {
      return res.status(404).json({ error: 'Трек не найден' });
    }

    await prisma.track.delete({
      where: { id: trackId }
    });

    const imagePath = path.join(__dirname, '..', 'public', 'images', track.imageUrl);
    const audioPath = path.join(__dirname, '..', 'public', 'tracks', track.filename);

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
};
