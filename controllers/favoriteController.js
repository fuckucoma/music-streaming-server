const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const jwt = require('jsonwebtoken');
require('dotenv').config();

const JWT_SECRET = process.env.JWT_SECRET;

const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    console.log('Authorization Header:', authHeader);
    
    const token = authHeader?.split(' ')[1];
    if (!token) {
        console.log('Токен отсутствует');
        return res.status(401).json({ error: 'Токен не предоставлен' });
    }

    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        console.log('Decoded Token:', decoded);
        req.userId = decoded.userId;
        next();
    } catch (error) {
        console.error('Ошибка проверки токена:', error.message);
        return res.status(403).json({ error: 'Недействительный токен' });
    }
};

exports.addFavorite = async (req, res) => {
    const { trackId } = req.body;


    console.log("Request User ID:", req.userId);
    console.log("Request Track ID:", trackId);

    try {
        
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
              track: true
          }
      });

      
      const baseUrl = process.env.BASE_URL || 'http://localhost:3000';

      
      const favoriteTracks = favorites.map(fav => ({
          favoriteid: fav.favoriteid,
          trackId: fav.trackId,
          title: fav.track.title, 
          artist: fav.track.artist,
          imageUrl: fav.track.imageUrl ? `${baseUrl}/images/${fav.track.imageUrl}` : null,
          filename: fav.track.filename,
          createdAt: fav.track.createdAt,
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
