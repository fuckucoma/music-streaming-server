const prisma = require('../lib/prisma');
const { positiveInt } = require('../lib/validation');
const { deleteUserAccount } = require('../services/userAccounts');
const { TrackError, updateTrack, deleteTrack } = require('../services/tracks');

exports.getDashboardData = async (req, res) => {
  try {
    const [users, tracks, complaints, reviews] = await Promise.all([
      prisma.user.count(),
      prisma.track.count(),
      prisma.complaint.count(),
      prisma.review.count(),
    ]);
    return res.json({ users, tracks, complaints, reviews });
  } catch (error) {
    console.error('Ошибка получения данных панели администратора:', error.code ?? error.name);
    return res.status(500).json({ error: 'Ошибка получения данных панели администратора' });
  }
};

exports.getAllUsers = async (req, res) => {
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
    return res.json(users);
  } catch (error) {
    console.error('Ошибка получения пользователей:', error.code ?? error.name);
    return res.status(500).json({ error: 'Ошибка получения пользователей' });
  }
};

exports.deleteUser = async (req, res) => {
  const id = positiveInt(req.params.id);
  if (id === null) return res.status(400).json({ error: 'Недопустимый идентификатор пользователя' });

  try {
    if (!await deleteUserAccount(id)) return res.status(404).json({ error: 'Пользователь не найден' });
    return res.json({ message: 'Пользователь удален' });
  } catch (error) {
    console.error('Ошибка удаления пользователя:', error.code ?? error.name);
    return res.status(500).json({ error: 'Ошибка удаления пользователя' });
  }
};

exports.editTrack = async (req, res) => {
  const id = positiveInt(req.params.id);
  if (id === null) return res.status(400).json({ error: 'Недопустимый идентификатор трека' });

  try {
    const track = await updateTrack(id, req.body);
    return res.json({ message: 'Трек обновлен', track });
  } catch (error) {
    if (error instanceof TrackError) return res.status(error.status).json({ error: error.message });
    console.error('Ошибка обновления трека:', error.code ?? error.name);
    return res.status(500).json({ error: 'Ошибка обновления трека' });
  }
};

exports.deleteTrack = async (req, res) => {
  const id = positiveInt(req.params.id);
  if (id === null) return res.status(400).json({ error: 'Недопустимый идентификатор трека' });

  try {
    await deleteTrack(id);
    return res.json({ message: 'Трек удален' });
  } catch (error) {
    if (error instanceof TrackError) return res.status(error.status).json({ error: error.message });
    console.error('Ошибка удаления трека:', error.code ?? error.name);
    return res.status(500).json({ error: 'Ошибка удаления трека' });
  }
};
