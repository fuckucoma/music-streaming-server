const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

exports.createComplaint = async (req, res) => {
  const { message } = req.body;
  const userId = req.user.userId;

  if (!message) {
    return res.status(400).json({ error: 'Сообщение обязательно для заполнения' });
  }

  try {
    const complaint = await prisma.complaint.create({
      data: { userId, message },
    });
    console.log('Complaint created:', complaint);
    res.status(201).json({ message: 'Жалоба успешно создана', complaint });
  } catch (error) {
    console.error('Ошибка создания жалобы:', error);
    res.status(500).json({ error: 'Ошибка создания жалобы' });
  }
};

exports.getAllComplaints = async (req, res) => {
  if (!req.user.isAdmin) {
    return res.status(403).json({ error: 'Доступ запрещен' });
  }

  try {
    const complaints = await prisma.complaint.findMany({
      include: { user: { select: { username: true } } },
      orderBy: { createdAt: 'desc' },
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

  if (!['pending', 'resolved', 'rejected'].includes(status)) {
    return res.status(400).json({ error: 'Недопустимый статус жалобы' });
  }

  try {
    const updatedComplaint = await prisma.complaint.update({
      where: { id: parseInt(id) },
      data: { status },
    });
    res.status(200).json({ message: 'Статус жалобы обновлен', updatedComplaint });
  } catch (error) {
    console.error('Ошибка обновления жалобы:', error);
    res.status(500).json({ error: 'Ошибка обновления жалобы' });
  }
};