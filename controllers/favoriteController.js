const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'your_jwt_secret_here';

const authenticateToken = (req, res, next) => {
    const token = req.headers['authorization']?.split(' ')[1];
    if (!token) {
      return res.status(401).json({ error: 'Токен не предоставлен' });
    }
    
    try {
      const decoded = jwt.verify(token, JWT_SECRET);
      req.userId = decoded.userId;
      next();
    } catch (error) {
      return res.status(403).json({ error: 'Недействительный токен' });
    }
  };

  exports.addFavorite = async (req, res) => {
    const { trackId } = req.body;


    console.log("Request User ID:", req.userId);
    console.log("Request Track ID:", trackId);

    try {
        // Проверка, добавлен ли уже этот трек в избранное
        const existingFavorite = await prisma.favorite.findUnique({
            where: {
                userId_trackId: {
                    userId: req.userId,
                    trackId: trackId,
                }
            }
        });

        if (existingFavorite) {
            return res.status(400).json({ error: 'Трек уже добавлен в избранное' });
        }

        const favorite = await prisma.favorite.create({
            data: { trackId, userId: req.userId }
        });

        res.status(201).json({ message: 'Трек добавлен в избранное', favorite });
    } catch (error) {
        console.error('Ошибка при добавлении в избранное:', error);
        res.status(500).json({ error: 'Ошибка добавления в избранное' });
    }
};

exports.removeFavorite = async (req, res) => {
    const { trackId } = req.body;

    try {
        const favorite = await prisma.favorite.deleteMany({
            where: {
                userId: req.userId,
                trackId: trackId, // Убедитесь, что trackId передается правильно
            },
        });

        console.log("User ID:", req.userId);
        console.log("Track ID:", trackId);

        if (favorite.count === 0) {
            return res.status(404).json({ error: `Трек с ID ${trackId} не найден в избранном пользователя с ID ${req.userId}` });
        }

        res.status(200).json({ message: 'Трек удален из избранного' });
    } catch (error) {
        console.error('Ошибка при удалении из избранного:', error);
        res.status(500).json({ error: 'Ошибка удаления из избранного' });
    }
};


exports.getFavorites = async (req, res) => {
  try {
      const favorites = await prisma.favorite.findMany({
          where: { userId: req.userId },
          include: {
              track: true // Включаем связанные данные о треке
          }
      });

      // Определяем базовый URL для изображений
      const baseUrl = process.env.BASE_URL || 'http://localhost:3000';

      // Модифицируем ответ, добавляя полный путь к изображению
      const favoriteTracks = favorites.map(fav => ({
          favoriteid: fav.favoriteid,
          trackId: fav.trackId,
          title: fav.track.title, 
          artist: fav.track.artist,
          imageUrl: fav.track.imageUrl ? `${baseUrl}/images/${fav.track.imageUrl}` : null,
          filename: fav.track.filename
      }));

      res.status(200).json({ favorites: favoriteTracks });
  } catch (error) {
      console.error('Ошибка при получении избранного:', error);
      res.status(500).json({ error: 'Ошибка получения избранного' });
  }
};
module.exports = { 
  addFavorite: exports.addFavorite, 
  getFavorites: exports.getFavorites, 
  removeFavorite: exports.removeFavorite, 
  authenticateToken 
};
