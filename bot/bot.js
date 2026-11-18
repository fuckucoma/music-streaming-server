const { Bot } = require('node-telegram-bot-api');
const prisma = require('../lib/prisma');
const { IMAGE_LIMIT, TrackError, saveTracks } = require('../services/tracks');

const TELEGRAM_AUDIO_LIMIT = 20 * 1024 * 1024;

async function downloadFile(api, token, file, limit) {
  if (file.file_size > limit) throw new TrackError(413, 'This file exceeds the Telegram download limit.');
  const info = await api.getFile({ file_id: file.file_id });
  if (info.file_size > limit) throw new TrackError(413, 'This file exceeds the Telegram download limit.');
  const parts = info.file_path?.split('/');
  if (!parts?.length || parts.some(part => !part || part === '.' || part === '..')) {
    throw new Error('Telegram did not return a valid file path');
  }
  const filePath = parts.map(encodeURIComponent).join('/');
  const response = await fetch(`https://api.telegram.org/file/bot${token}/${filePath}`, {
    redirect: 'error',
    signal: AbortSignal.timeout(60_000),
  });
  if (!response.ok || !response.body || Number(response.headers.get('content-length')) > limit) {
    await response.body?.cancel();
    throw new TrackError(400, 'Telegram could not provide a downloadable file within the limit.');
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of response.body) {
    size += chunk.byteLength;
    if (size > limit) throw new TrackError(413, 'This file exceeds the Telegram download limit.');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks, size);
}

function launch() {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    console.log('Telegram bot disabled');
    return;
  }
  const uploaders = new Set((process.env.TELEGRAM_UPLOAD_USER_IDS || '').split(',')
    .map(value => value.trim()).filter(value => /^\d+$/.test(value)));
  const bot = new Bot(token);
  let busy = false;

  bot.command('start', ctx => ctx.reply(
    'Send an audio file in this private chat to add it to the music library. Upload access is required.\n\nMP3, FLAC, AAC, OGG, WAV, M4A',
  ));

  bot.on('message', async ctx => {
    const message = ctx.message;
    const media = message?.audio || message?.document;
    if (!media || !ctx.from?.id || ctx.chat?.type !== 'private') return;
    const telegramId = String(ctx.from.id);
    if (!uploaders.has(telegramId)) {
      const user = await prisma.user.findUnique({ where: { telegramId }, select: { isAdmin: true } });
      if (!user?.isAdmin) {
        await ctx.reply('This account cannot add tracks to the library.');
        return;
      }
    }
    if (busy) {
      await ctx.reply('Another track is being uploaded. Try again shortly.');
      return;
    }

    busy = true;
    let result;
    try {
      const buffer = await downloadFile(ctx.api, token, media, TELEGRAM_AUDIO_LIMIT);
      const thumbnail = media.thumbnail || media.thumb;
      const [track] = await saveTracks([{
        audio: { buffer, size: buffer.length, originalname: media.file_name || '' },
        fallback: { title: media.title, artist: media.performer, duration: media.duration },
        loadFallbackCover: thumbnail ? () => downloadFile(ctx.api, token, thumbnail, IMAGE_LIMIT).catch(() => null) : undefined,
      }]);
      const details = [track.title, track.artist, track.album, track.genre].filter(Boolean).join('\n');
      result = `Track added\n\n${details}\n\nID: ${track.id}`;
    } catch (error) {
      console.error('Telegram track upload failed:', error.code || error.name);
      result = error instanceof TrackError ? error.message : 'Could not save the track. Try again later.';
    } finally {
      busy = false;
    }
    await ctx.reply(result);
  });

  bot.catch(error => console.error('Telegram update failed:', error.name));
  void bot.init().then(() => {
    console.log('Telegram bot started');
    return bot.startPolling(undefined, { allowedUpdates: ['message'] });
  }).catch(error => console.error('Telegram polling failed:', error.name));
  return bot;
}

module.exports = { launch };
