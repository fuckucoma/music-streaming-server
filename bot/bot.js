const TelegramBot = require('node-telegram-bot-api');
const { PrismaClient } = require('@prisma/client');
const path = require('path');
const fs = require('fs');
const https = require('https');
const mm = require('music-metadata');

const prisma = new PrismaClient();
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;

if (!BOT_TOKEN) {
  console.warn('⚠️  TELEGRAM_BOT_TOKEN not set — bot disabled');
  module.exports = { launch: () => {} };
  // Use return trick for CommonJS early exit
  return;
}

// ── Download file from Telegram CDN ──────────────────────────
function downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    https.get(url, res => {
      res.pipe(file);
      file.on('finish', () => file.close(resolve));
      file.on('error', reject);
    }).on('error', err => {
      fs.unlink(dest, () => {});
      reject(err);
    });
  });
}

// ── Extract cover art from audio file ────────────────────────
async function extractCover(filePath, baseName) {
  try {
    const metadata = await mm.parseFile(filePath, { skipCovers: false });
    const pic = metadata.common.picture?.[0];
    if (!pic) return null;

    const ext = pic.format?.includes('png') ? 'png' : 'jpg';
    const imgFilename = `${baseName}.${ext}`;
    const imgPath = path.join(__dirname, '..', 'public', 'images', imgFilename);
    fs.writeFileSync(imgPath, pic.data);
    return imgFilename;
  } catch {
    return null;
  }
}

// ── Extract audio metadata ────────────────────────────────────
async function extractMetadata(filePath, fallbackTitle) {
  try {
    const metadata = await mm.parseFile(filePath);
    return {
      title:    metadata.common.title   ?? fallbackTitle,
      artist:   metadata.common.artist  ?? 'Unknown',
      album:    metadata.common.album   ?? null,
      genre:    metadata.common.genre?.[0] ?? null,
      duration: metadata.format.duration
        ? Math.round(metadata.format.duration)
        : null,
    };
  } catch {
    return { title: fallbackTitle, artist: 'Unknown', album: null, genre: null, duration: null };
  }
}

// ── Main launch function ──────────────────────────────────────
function launch() {
  const bot = new TelegramBot(BOT_TOKEN, { polling: true });
  console.log('🤖 Telegram bot started');

  // /start
  bot.onText(/\/start/, (msg) => {
    const name = msg.from?.first_name ?? 'there';
    bot.sendMessage(msg.chat.id,
      `👋 Hi ${name}!\n\n` +
      `Send me any audio file and I'll add it to the music library.\n\n` +
      `Supported formats: MP3, FLAC, AAC, OGG, WAV, M4A\n\n` +
      `You can also forward audio from other chats.`
    );
  });

  // /help
  bot.onText(/\/help/, (msg) => {
    bot.sendMessage(msg.chat.id,
      `🎵 *Music Import Bot*\n\n` +
      `Just send or forward any audio file.\n\n` +
      `I'll automatically extract:\n` +
      `• Title & artist from tags\n` +
      `• Album & genre\n` +
      `• Cover art\n\n` +
      `The track appears in the Mini App immediately.`,
      { parse_mode: 'Markdown' }
    );
  });

  // Handle all messages
  bot.on('message', async (msg) => {
    const chatId = msg.chat.id;

    // Only process audio files
    const audio = msg.audio ?? msg.document ?? msg.video;
    if (!audio) return;

    // If sent as document, verify it's audio
    if (msg.document) {
      const mime = msg.document.mime_type ?? '';
      if (!mime.startsWith('audio/')) {
        bot.sendMessage(chatId, '❌ Please send an audio file (MP3, FLAC, etc.)');
        return;
      }
    }

    // Also skip video files unless they're audio in video container (skip for simplicity)
    if (msg.video) return;

    const statusMsg = await bot.sendMessage(chatId, '⏳ Downloading…');

    try {
      // Get download URL from Telegram
      const fileInfo = await bot.getFile(audio.file_id);
      const fileUrl = `https://api.telegram.org/file/bot${BOT_TOKEN}/${fileInfo.file_path}`;

      // Build safe unique filename
      const originalName = msg.audio?.file_name
        ?? msg.document?.file_name
        ?? `track_${Date.now()}.mp3`;
      const ext = path.extname(originalName).toLowerCase() || '.mp3';
      const baseName = `tg_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
      const filename = `${baseName}${ext}`;
      const destPath = path.join(__dirname, '..', 'public', 'tracks', filename);

      // Ensure directories exist
      fs.mkdirSync(path.join(__dirname, '..', 'public', 'tracks'), { recursive: true });
      fs.mkdirSync(path.join(__dirname, '..', 'public', 'images'), { recursive: true });

      // Download the file
      await bot.editMessageText('⏳ Saving file…', {
        chat_id: chatId,
        message_id: statusMsg.message_id,
      });
      await downloadFile(fileUrl, destPath);

      // Extract metadata
      await bot.editMessageText('⏳ Reading metadata…', {
        chat_id: chatId,
        message_id: statusMsg.message_id,
      });

      const fallbackTitle = path.parse(originalName).name;
      const meta = await extractMetadata(destPath, fallbackTitle);
      const imageFilename = await extractCover(destPath, baseName);

      // Save to database — matches your exact Prisma schema
      const track = await prisma.track.create({
        data: {
          title:    meta.title,
          artist:   meta.artist,
          album:    meta.album,
          genre:    meta.genre,
          filename: filename,
          imageUrl: imageFilename ?? null,
          createdAt: new Date(),
        },
      });

      const coverLine = imageFilename ? '🖼 Cover art saved\n' : '';
      const albumLine = meta.album ? `💿 ${meta.album}\n` : '';
      const genreLine = meta.genre ? `🏷 ${meta.genre}\n` : '';

      await bot.editMessageText(
        `✅ *Track added!*\n\n` +
        `🎵 ${track.title}\n` +
        `👤 ${track.artist}\n` +
        albumLine +
        genreLine +
        coverLine +
        `\n_Track ID: ${track.id}_`,
        {
          chat_id: chatId,
          message_id: statusMsg.message_id,
          parse_mode: 'Markdown',
        }
      );

      console.log(`[Bot] Track added: "${track.title}" by ${track.artist} (id=${track.id})`);

    } catch (err) {
      console.error('[Bot] Upload error:', err.message);
      await bot.editMessageText(
        `❌ Failed to add track.\n\n_${err.message}_`,
        {
          chat_id: chatId,
          message_id: statusMsg.message_id,
          parse_mode: 'Markdown',
        }
      ).catch(() => {});
    }
  });

  // Prevent crash on polling errors (network blips etc.)
  bot.on('polling_error', (err) => {
    console.error('[Bot] Polling error:', err.message);
  });

  return bot;
}

module.exports = { launch };