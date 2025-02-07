const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

exports.createReview = async (req, res) => {
  const { trackId, content, rating } = req.body;
  const userId = req.user.userId;

  if (!trackId || !content || !rating) {
    return res.status(400).json({ error: 'Все поля обязательны для заполнения' });
  }

  if (rating < 1 || rating > 5) {
    return res.status(400).json({ error: 'Рейтинг должен быть от 1 до 5' });
  }

  try {
    const review = await prisma.review.create({
      data: { userId, trackId, content, rating, userProfileImage },
    });
    res.status(201).json({ message: 'Отзыв создан', review });
  } catch (error) {
    console.error('Ошибка создания отзыва:', error);
    res.status(500).json({ error: 'Ошибка создания отзыва' });
  }
};

exports.getReviewsForTrack = async (req, res) => {
  try {
    const trackId = parseInt(req.params.trackId, 10);
    if (!trackId) {
      return res.status(400).json({ error: 'trackId is invalid' });
    }

    const reviews = await prisma.review.findMany({
      where: { trackId },
      include: {
        user: true, 
        track: true,  
      },
    });

    res.status(200).json(reviews);
  } catch (err) {
    console.error('Error fetching reviews for track:', err);
    res.status(500).json({ error: 'Server error' });
  }
};

exports.getAllReviews = async (req, res) => {
  if (!req.user.isAdmin) {
    return res.status(403).json({ error: 'Доступ запрещен' });
  }

  try {
    const reviews = await prisma.review.findMany({
      include: {
        user: { select: { username: true, profileImageUrl: true } },
        track: { select: { title: true, artist: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
    res.status(200).json(reviews);
  } catch (error) {
    console.error('Ошибка получения отзывов:', error);
    res.status(500).json({ error: 'Ошибка получения отзывов' });
  }
};

exports.deleteReview = async (req, res) => {
  if (!req.user.isAdmin) {
    return res.status(403).json({ error: 'Доступ запрещен' });
  }

  const { id } = req.params;

  try {
    await prisma.review.delete({
      where: { id: parseInt(id) },
    });
    res.status(200).json({ message: 'Отзыв удален' });
  } catch (error) {
    console.error('Ошибка удаления отзыва:', error);
    res.status(500).json({ error: 'Ошибка удаления отзыва' });
  }
};

exports.deleteUserReview = async (req, res) => {
  const { id } = req.params;
  const userId = req.user.userId;

  try {
    // Получаем отзыв по ID
    const review = await prisma.review.findUnique({
      where: { id: parseInt(id) },
    });

    // Проверка, что отзыв принадлежит текущему пользователю
    if (review.userId !== userId) {
      return res.status(403).json({ error: 'Вы не можете удалить этот отзыв' });
    }

    // Удаляем отзыв
    await prisma.review.delete({
      where: { id: parseInt(id) },
    });

    res.status(200).json({ message: 'Отзыв удален' });
  } catch (error) {
    console.error('Ошибка удаления отзыва:', error);
    res.status(500).json({ error: 'Ошибка удаления отзыва' });
  }
};