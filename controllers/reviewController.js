const prisma = require('../lib/prisma');
const { positiveInt } = require('../lib/validation');

const authorFields = { id: true, username: true, profileImageUrl: true };
const trackFields = {
  id: true,
  title: true,
  artist: true,
  createdAt: true,
  album: true,
  imageUrl: true,
  duration: true,
  genre: true,
  rating: true,
};

exports.createReview = async (req, res) => {
  const { trackId: rawTrackId, content, rating: rawRating } = req.body ?? {};
  const trackId = positiveInt(rawTrackId);
  const rating = positiveInt(rawRating);
  if (trackId === null || typeof content !== 'string' || !content.trim()) {
    return res.status(400).json({ error: 'Укажите трек и текст отзыва' });
  }
  if (rating === null || rating > 5) {
    return res.status(400).json({ error: 'Рейтинг должен быть целым числом от 1 до 5' });
  }

  try {
    const review = await prisma.review.create({
      data: { userId: req.user.userId, trackId, content: content.trim(), rating },
    });
    return res.status(201).json({ message: 'Отзыв создан', review });
  } catch (error) {
    if (error.code === 'P2003') {
      return res.status(404).json({ error: 'Трек или пользователь не найден' });
    }
    console.error('Ошибка создания отзыва:', error.code ?? error.name);
    return res.status(500).json({ error: 'Ошибка создания отзыва' });
  }
};

exports.getReviewsForTrack = async (req, res) => {
  const trackId = positiveInt(req.params.trackId);
  if (trackId === null) return res.status(400).json({ error: 'Недопустимый идентификатор трека' });

  try {
    const reviews = await prisma.review.findMany({
      where: { trackId },
      include: { user: { select: authorFields }, track: { select: trackFields } },
    });
    return res.json(reviews);
  } catch (error) {
    console.error('Ошибка получения отзывов трека:', error.code ?? error.name);
    return res.status(500).json({ error: 'Ошибка получения отзывов' });
  }
};

function listReviews(trackSelect) {
  return async (req, res) => {
    try {
      const reviews = await prisma.review.findMany({
        include: { user: { select: authorFields }, track: { select: trackSelect } },
        orderBy: { createdAt: 'desc' },
      });
      return res.json(reviews);
    } catch (error) {
      console.error('Ошибка получения отзывов:', error.code ?? error.name);
      return res.status(500).json({ error: 'Ошибка получения отзывов' });
    }
  };
}

exports.getAllReviews = listReviews({ title: true, artist: true });
exports.getAdminReviews = listReviews({ title: true });

async function deleteReview(req, res, scope) {
  const id = positiveInt(req.params.id);
  if (id === null) return res.status(400).json({ error: 'Недопустимый идентификатор отзыва' });

  try {
    const { count } = await prisma.review.deleteMany({ where: { id, ...scope } });
    if (count === 0) return res.status(404).json({ error: 'Отзыв не найден' });
    return res.json({ message: 'Отзыв удален' });
  } catch (error) {
    console.error('Ошибка удаления отзыва:', error.code ?? error.name);
    return res.status(500).json({ error: 'Ошибка удаления отзыва' });
  }
}

exports.deleteReview = (req, res) => deleteReview(req, res, {});
exports.deleteUserReview = (req, res) => {
  const userId = positiveInt(req.user?.userId);
  if (userId === null) return res.status(401).json({ error: 'Требуется авторизация' });
  return deleteReview(req, res, { userId });
};
