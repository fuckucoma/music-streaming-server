function telegramPhotoUrl(photo) {
  if (!photo) return null;
  try {
    const url = new URL(photo);
    return url.protocol === 'https:' && !url.username && !url.password ? url.href : null;
  } catch {
    return null;
  }
}

function telegramIdentity(user) {
  const telegramId = String(user.id);
  return {
    telegramId,
    telegramName: [user.first_name, user.last_name].filter(Boolean).join(' ') || user.username || `User${telegramId}`,
    telegramUsername: user.username ?? null,
    telegramPhotoUrl: telegramPhotoUrl(user.photo_url),
  };
}

module.exports = { telegramIdentity };
