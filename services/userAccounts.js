const { randomUUID } = require('node:crypto');
const prisma = require('../lib/prisma');
const supabase = require('../lib/supabase');

function imageBucket() {
  return supabase.storage.from('images');
}

function ownedAvatarPath(bucket, userId, avatarUrl) {
  if (!avatarUrl) return null;
  try {
    const root = new URL(bucket.getPublicUrl('avatars/').data.publicUrl);
    const url = new URL(avatarUrl);
    if (url.origin !== root.origin || !url.pathname.startsWith(root.pathname)) return null;
    const filename = url.pathname.slice(root.pathname.length);
    const owned = new RegExp(`^${userId}_(?:\\d+|[a-f0-9-]{36})\\.(?:jpg|png|webp|gif)$`);
    return owned.test(filename) ? `avatars/${filename}` : null;
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
  if (user.profileImageUrl) {
    const bucket = imageBucket();
    await removeImage(bucket, ownedAvatarPath(bucket, id, user.profileImageUrl));
  }
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

  await removeImage(bucket, ownedAvatarPath(bucket, id, current.profileImageUrl));
  return { status: 'saved', profileImageUrl };
}

module.exports = { deleteUserAccount, updateUserAvatar };
