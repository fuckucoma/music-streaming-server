const prisma = require('../lib/prisma');
const { positiveInt } = require('../lib/validation');

const complaintStatuses = new Set(['pending', 'resolved', 'rejected']);

exports.createComplaint = async (req, res) => {
  const { message } = req.body ?? {};
  if (typeof message !== 'string' || !message.trim()) {
    return res.status(400).json({ error: 'Сообщение обязательно для заполнения' });
  }

  try {
    const complaint = await prisma.complaint.create({
      data: { userId: req.user.userId, message: message.trim() },
    });
    return res.status(201).json({ message: 'Жалоба успешно создана', complaint });
  } catch (error) {
    if (error.code === 'P2003') return res.status(404).json({ error: 'Пользователь не найден' });
    console.error('Ошибка создания жалобы:', error.code ?? error.name);
    return res.status(500).json({ error: 'Ошибка создания жалобы' });
  }
};

exports.getAllComplaints = async (req, res) => {
  try {
    const complaints = await prisma.complaint.findMany({
      include: { user: { select: { username: true } } },
      orderBy: { createdAt: 'desc' },
    });
    return res.json(complaints);
  } catch (error) {
    console.error('Ошибка получения жалоб:', error.code ?? error.name);
    return res.status(500).json({ error: 'Ошибка получения жалоб' });
  }
};

function updateComplaint(formatResponse) {
  return async (req, res) => {
    const id = positiveInt(req.params.id);
    const { status } = req.body ?? {};
    if (id === null) return res.status(400).json({ error: 'Недопустимый идентификатор жалобы' });
    if (!complaintStatuses.has(status)) return res.status(400).json({ error: 'Недопустимый статус жалобы' });

    try {
      const complaint = await prisma.complaint.update({ where: { id }, data: { status } });
      return res.json(formatResponse(complaint));
    } catch (error) {
      if (error.code === 'P2025') return res.status(404).json({ error: 'Жалоба не найдена' });
      console.error('Ошибка обновления жалобы:', error.code ?? error.name);
      return res.status(500).json({ error: 'Ошибка обновления жалобы' });
    }
  };
}

exports.updateComplaint = updateComplaint((updatedComplaint) => ({
  message: 'Статус жалобы обновлен',
  updatedComplaint,
}));
exports.updateAdminComplaint = updateComplaint((complaint) => ({
  message: 'Жалоба обновлена',
  complaint,
}));
