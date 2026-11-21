const prisma = require('../lib/prisma');
const { positiveInt } = require('../lib/validation');
const { publicAudioUrl } = require('../services/tracks');

exports.addFavorite = async (req, res) => {
  const trackId = positiveInt(req.body?.trackId);
  if (!trackId) return res.status(400).json({ error: 'Invalid track ID' });

  const userId = req.user.userId;
  try {
    const favorite = await prisma.favorite.create({ data: { trackId, userId } });
    return res.status(201).json({ message: 'Трек добавлен в избранное', favorite });
  } catch (error) {
    if (error.code === 'P2002') {
      const favorite = await prisma.favorite.findUnique({ where: { userId_trackId: { userId, trackId } } });
      return res.json({ message: 'Трек уже добавлен в избранное', favorite });
    }
    if (error.code === 'P2003') return res.status(404).json({ error: 'Track or user not found' });
    throw error;
  }
};

exports.removeFavorite = async (req, res) => {
  const trackId = positiveInt(req.body?.trackId);
  if (!trackId) return res.status(400).json({ error: 'Invalid track ID' });

  await prisma.favorite.deleteMany({ where: { userId: req.user.userId, trackId } });
  return res.json({ message: 'Трек удален из избранного' });
};

exports.getFavorites = async (req, res) => {
  const favorites = await prisma.favorite.findMany({
    where: { userId: req.user.userId },
    select: {
      favoriteId: true,
      trackId: true,
      track: {
        select: {
          title: true, artist: true, album: true, genre: true, duration: true,
          imageUrl: true, filename: true, createdAt: true,
        },
      },
    },
    orderBy: { favoriteId: 'desc' },
  });
  return res.json({
    favorites: favorites.map(({ track, ...favorite }) => ({
      ...favorite, ...track, streamUrl: publicAudioUrl(track.filename),
    })),
  });
};
