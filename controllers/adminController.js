const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

exports.getDashboardData = async (req, res) => {
  if (!req.user.isAdmin) {
    return res.status(403).json({ error: 'Доступ запрещен' });
  }

  try {
    const usersCount = await prisma.user.count();
    const tracksCount = await prisma.track.count();
    const complaintsCount = await prisma.complaint.count();
    const reviewsCount = await prisma.review.count();

    res.status(200).json({
      users: usersCount,
      tracks: tracksCount,
      complaints: complaintsCount,
      reviews: reviewsCount,
    });
  } catch (error) {
    console.error('Ошибка получения данных панели администратора:', error);
    res.status(500).json({ error: 'Ошибка получения данных панели администратора' });
  }
};

exports.getAllUsers = async (req, res) => {
  if (!req.user.isAdmin) {
    return res.status(403).json({ error: 'Доступ запрещен' });
  }

  try {
    const users = await prisma.user.findMany({
      select: {
        id: true,
        username: true,
        profileImageUrl: true,
        createdAt: true,
        updatedAt: true,
        isAdmin: true,
      },
    });
    res.status(200).json(users);
  } catch (error) {
    console.error('Ошибка получения пользователей:', error);
    res.status(500).json({ error: 'Ошибка получения пользователей' });
  }
};

exports.deleteUser = async (req, res) => {
  if (!req.user.isAdmin) {
    return res.status(403).json({ error: 'Доступ запрещен' });
  }

  const { id } = req.params;

  try {
    await prisma.user.delete({ where: { id: parseInt(id) } });
    res.status(200).json({ message: 'Пользователь удален' });
  } catch (error) {
    console.error('Ошибка удаления пользователя:', error);
    res.status(500).json({ error: 'Ошибка удаления пользователя' });
  }
};

exports.getAllComplaints = async (req, res) => {
  if (!req.user.isAdmin) {
    return res.status(403).json({ error: 'Доступ запрещен' });
  }

  try {
    const complaints = await prisma.complaint.findMany({
      include: { user: { select: { username: true } } },
    });
    res.status(200).json(complaints);
  } catch (error) {
    console.error('Ошибка получения жалоб:', error);
    res.status(500).json({ error: 'Ошибка получения жалоб' });
  }
};

exports.updateComplaint = async (req, res) => {
  if (!req.user.isAdmin) {
    return res.status(403).json({ error: 'Доступ запрещен' });
  }

  const { id } = req.params;
  const { status } = req.body;

  try {
    const complaint = await prisma.complaint.update({
      where: { id: parseInt(id) },
      data: { status },
    });
    res.status(200).json({ message: 'Жалоба обновлена', complaint });
  } catch (error) {
    console.error('Ошибка обновления жалобы:', error);
    res.status(500).json({ error: 'Ошибка обновления жалобы' });
  }
};

exports.getAllReviews = async (req, res) => {
  if (!req.user.isAdmin) {
    return res.status(403).json({ error: 'Доступ запрещен' });
  }

  try {
    const reviews = await prisma.review.findMany({
      include: {
        user: { select: { id: true, username: true , profileImageUrl: true} },
        track: { select: { title: true } },
      },
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
    await prisma.review.delete({ where: { id: parseInt(id) } });
    res.status(200).json({ message: 'Отзыв удален' });
  } catch (error) {
    console.error('Ошибка удаления отзыва:', error);
    res.status(500).json({ error: 'Ошибка удаления отзыва' });
  }
};

exports.editTrack = async (req, res) => {
  if (!req.user.isAdmin) {
    return res.status(403).json({ error: 'Доступ запрещен' });
  }

  const { id } = req.params;
  const { title, artist, album, genre } = req.body;

  try {
    const track = await prisma.track.update({
      where: { id: parseInt(id) },
      data: { title, artist, album, genre },
    });
    res.status(200).json({ message: 'Трек обновлен', track });
  } catch (error) {
    console.error('Ошибка обновления трека:', error);
    res.status(500).json({ error: 'Ошибка обновления трека' });
  }
};

exports.deleteTrack = async (req, res) => {
  if (!req.user.isAdmin) {
    return res.status(403).json({ error: 'Доступ запрещен' });
  }

  const { id } = req.params;

  try {
    await prisma.track.delete({ where: { id: parseInt(id) } });
    res.status(200).json({ message: 'Трек удален' });
  } catch (error) {
    console.error('Ошибка удаления трека:', error);
    res.status(500).json({ error: 'Ошибка удаления трека' });
  }
};
