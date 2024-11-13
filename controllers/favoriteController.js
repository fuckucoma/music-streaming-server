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
  
    try {
      const favorite = await prisma.favorite.create({
        data: { trackId, userId: req.userId }
      });
  
      res.status(201).json({ message: 'Трек добавлен в избранное', favorite });
    } catch (error) {
      console.error('Ошибка при добавлении в избранное:', error);
      res.status(500).json({ error: 'Ошибка добавления в избранное' });
    }
  };

  exports.getFavorites = async (req, res) => {
    try {
      const favorites = await prisma.favorite.findMany({
        where: { userId: req.userId }
      });
      res.status(200).json({ favorites });
    } catch (error) {
      console.error('Ошибка при получении избранного:', error);
      res.status(500).json({ error: 'Ошибка получения избранного' });
    }
  };

  module.exports = { addFavorite: exports.addFavorite, getFavorites: exports.getFavorites, authenticateToken };
