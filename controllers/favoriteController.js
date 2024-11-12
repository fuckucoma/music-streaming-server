const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

exports.addFavorite = async (req, res) => {
  if (!req.session.userId) {
      return res.status(401).json({ error: 'Необходимо войти в систему' });
  }

  const { trackId } = req.body;

  try {
      const favorite = await prisma.favorite.create({
          data: { trackId, userId: req.session.userId }
      });

      res.status(201).json({ message: 'Трек добавлен в избранное', favorite });
  } catch (error) {
      res.status(500).json({ error: 'Ошибка добавления в избранное' });
  }
};

exports.getFavorites = async (req, res) => {
  if (!req.session.userId) {
      return res.status(401).json({ error: 'Необходимо войти в систему' });
  }

  try {
      const favorites = await prisma.favorite.findMany({ where: { userId: req.session.userId } });
      res.status(200).json({ favorites });
  } catch (error) {
      res.status(500).json({ error: 'Ошибка получения избранного' });
  }
};
