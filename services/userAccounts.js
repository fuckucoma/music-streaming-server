const { randomUUID } = require('node:crypto');
const prisma = require('../lib/prisma');
const supabase = require('../lib/supabase');

function imageBucket() {
  return supabase.storage.from('images');
}

function managedAvatar(bucket, avatarUrl) {
  if (!avatarUrl) return null;
  try {
    const root = new URL(bucket.getPublicUrl('avatars/').data.publicUrl);
    const url = new URL(avatarUrl);
    if (url.origin !== root.origin || !url.pathname.startsWith(root.pathname)) return null;
    const filename = url.pathname.slice(root.pathname.length);
    const match = /^([1-9]\d*)_(?:\d+|[a-f0-9-]{36})\.(?:jpg|png|webp|gif)$/.exec(filename);
    const owner = Number(match?.[1]);
    return Number.isInteger(owner) && owner <= 2147483647 ? { owner, path: `avatars/${filename}` } : null;
  } catch {
    return null;
  }
}

async function removeImage(bucket, path) {
  if (!path) return;
  try {
    const { error } = await bucket.remove([path]);
    if (error) console.warn('Avatar storage cleanup failed');
  } catch {
    console.warn('Avatar storage cleanup failed');
  }
}

async function cleanupUserAvatar(id, profileImageUrl) {
  if (!profileImageUrl) return;
  const bucket = imageBucket();
  const avatar = managedAvatar(bucket, profileImageUrl);
  if (!avatar) return;
  if (avatar.owner !== id) {
    // Merged profiles may retain an avatar from a deleted Telegram-only account.
    try {
      const existing = await prisma.user.findFirst({
        where: { OR: [{ id: avatar.owner }, { profileImageUrl }] },
        select: { id: true },
      });
      if (existing) return;
    } catch {
      console.warn('Transferred avatar ownership could not be confirmed');
      return;
    }
  }
  await removeImage(bucket, avatar.path);
}

async function deleteUserAccount(id) {
  let user;
  try {
    user = await prisma.$transaction(async (tx) => {
      await tx.favorite.deleteMany({ where: { userId: id } });
      await tx.review.deleteMany({ where: { userId: id } });
      await tx.complaint.deleteMany({ where: { userId: id } });
      return tx.user.delete({ where: { id }, select: { profileImageUrl: true } });
    });
  } catch (error) {
    if (error.code === 'P2025') return false;
    throw error;
  }
  await cleanupUserAvatar(id, user.profileImageUrl);
  return true;
}

async function updateUserAvatar(id, buffer, { extension, contentType }) {
  const where = { id };
  const select = { profileImageUrl: true };
  const current = await prisma.user.findUnique({ where, select });
  if (!current) return { status: 'missing' };

  const bucket = imageBucket();
  const path = `avatars/${id}_${randomUUID()}${extension}`;
  const profileImageUrl = bucket.getPublicUrl(path).data.publicUrl;
  const { error } = await bucket.upload(path, buffer, { contentType, upsert: false });
  if (error) throw new Error('Avatar storage upload failed');

  let updated;
  try {
    const { count } = await prisma.user.updateMany({
      where: { id, profileImageUrl: current.profileImageUrl },
      data: { profileImageUrl },
    });
    updated = count === 1;
  } catch (updateError) {
    // A database timeout can arrive after the change committed. Confirm before deleting the new file.
    const saved = await prisma.user.findUnique({ where, select }).catch(() => undefined);
    if (saved === undefined) throw updateError;
    if (saved?.profileImageUrl !== profileImageUrl) {
      await removeImage(bucket, path);
      throw updateError;
    }
    updated = true;
  }

  if (!updated) {
    await removeImage(bucket, path);
    return { status: 'conflict' };
  }

  await cleanupUserAvatar(id, current.profileImageUrl);
  return { status: 'saved', profileImageUrl };
}

module.exports = { cleanupUserAvatar, deleteUserAccount, updateUserAvatar };
