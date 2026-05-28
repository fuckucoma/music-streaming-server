const TelegramBot = require('node-telegram-bot-api');
const { PrismaClient } = require('@prisma/client');
const https    = require('https');
const fs       = require('fs');
const path     = require('path');
const mm       = require('music-metadata');
const supabase = require('../lib/supabase');
require('dotenv').config();

const prisma    = new PrismaClient();
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const SUPABASE_URL = process.env.SUPABASE_URL;

if (!BOT_TOKEN) {
  console.warn('⚠️  TELEGRAM_BOT_TOKEN not set — bot disabled');
  module.exports = { launch: () => {} };
  return;
}

// ── Download file to /tmp ─────────────────────────────────────
function downloadToTmp(url, dest) {
  return new Promise((resolve, reject) => {
    https.get(url, res => {
      // Ensure we actually got a successful response
      if (res.statusCode !== 200) {
        return reject(new Error(`Download failed: HTTP ${res.statusCode}`));
      }
      
      const file = fs.createWriteStream(dest);
      res.pipe(file);
      
      file.on('finish', () => {
        file.close(resolve); 
      });
      
      // Catch network stream interruptions
      res.on('error', err => {
        fs.unlink(dest, () => {}); 
        reject(err);
      });
      
    }).on('error', err => { 
      fs.unlink(dest, () => {}); 
      reject(err); 
    });
  });
}

// ── Upload buffer to Supabase Storage ────────────────────────
async function uploadToSupabase(bucket, storagePath, buffer, contentType) {
  const { error } = await supabase.storage
    .from(bucket)
    .upload(storagePath, buffer, { contentType, upsert: true });
  if (error) throw new Error(error.message);
  return `${SUPABASE_URL}/storage/v1/object/public/${bucket}/${storagePath}`;
}

// ── Extract metadata from tmp file ───────────────────────────
async function extractMeta(filePath, tgAudio, fallbackName) {
  // 1. Establish a strong baseline using Telegram's built-in metadata
  let meta = {
    title:    tgAudio?.title ?? fallbackName,
    artist:   tgAudio?.performer ?? 'Unknown',
    album:    null,
    genre:    null,
    duration: tgAudio?.duration ?? null,
    cover:    null
  };

  try {
    const m = await mm.parseFile(filePath);
    
    // 2. Only overwrite the baseline if mm successfully found the tags
    if (m.common.title) meta.title = m.common.title;
    if (m.common.artist) meta.artist = m.common.artist;
    if (m.common.album) meta.album = m.common.album;
    if (m.common.genre?.length) meta.genre = m.common.genre[0];
    if (m.format.duration) meta.duration = Math.round(m.format.duration);
    if (m.common.picture?.length) meta.cover = m.common.picture[0];
    
  } catch (err) {
    // Log the error instead of failing silently!
    console.warn(`[Bot] Metadata warning for ${fallbackName}: ${err.message}`);
    // If it crashes (e.g., missing EOF marker), we safely return the Telegram baseline 
    // instead of wiping everything to 'Unknown'.
  }

  return meta;
}

function launch() {
  const bot = new TelegramBot(BOT_TOKEN, { polling: true });
  console.log('🤖 Telegram bot started');

  bot.onText(/\/start/, msg => {
    bot.sendMessage(msg.chat.id,
      `👋 Hi ${msg.from?.first_name ?? 'there'}!\n\nSend me any audio file to add it to the music library.\n\nSupported: MP3, FLAC, AAC, OGG, WAV, M4A`
    );
  });

  bot.on('message', async msg => {
    const chatId = msg.chat.id;
    const audio  = msg.audio ?? msg.document ?? null;
    if (!audio) return;

    if (msg.document) {
      const mime = msg.document.mime_type ?? '';
      if (!mime.startsWith('audio/')) {
        bot.sendMessage(chatId, '❌ Please send an audio file.');
        return;
      }
    }

    const statusMsg = await bot.sendMessage(chatId, '⏳ Downloading…');

    try {
      const fileInfo  = await bot.getFile(audio.file_id);
      const fileUrl   = `https://api.telegram.org/file/bot${BOT_TOKEN}/${fileInfo.file_path}`;
      const origName  = msg.audio?.file_name ?? msg.document?.file_name ?? `track_${Date.now()}.mp3`;
      const ext       = path.extname(origName).toLowerCase() || '.mp3';
      const baseName  = `tg_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
      const tmpPath   = `/tmp/${baseName}${ext}`;

      // Download to /tmp
      await bot.editMessageText('⏳ Saving…', { chat_id: chatId, message_id: statusMsg.message_id });
      await downloadToTmp(fileUrl, tmpPath);

      // Extract metadata
      await bot.editMessageText('⏳ Reading metadata…', { chat_id: chatId, message_id: statusMsg.message_id });
      const meta = await extractMeta(tmpPath, msg.audio, path.parse(origName).name);

      // Upload audio to Supabase
      const audioBuffer  = fs.readFileSync(tmpPath);
      const audioStoragePath = `${baseName}${ext}`;
      const audioUrl     = await uploadToSupabase('tracks', audioStoragePath, audioBuffer, `audio/${ext.slice(1)}`);

      // Upload cover if present
      let imageUrl = null;
      if (meta.cover && meta.cover.data) {
        try {
          const imgExt  = meta.cover.format?.includes('png') ? 'png' : 'jpg';
          const imgPath = `${baseName}.${imgExt}`;
          imageUrl = await uploadToSupabase('images', imgPath, meta.cover.data, meta.cover.format || `image/${imgExt}`);
        } catch (err) {
          console.warn('[Bot] Ошибка загрузки ID3 обложки:', err.message);
        }
      }

      const tgThumb = msg.audio?.thumbnail || msg.audio?.thumb; 
      if (!imageUrl && tgThumb) {
        try {
          // Получаем путь к превьюшке на серверах Telegram
          const thumbInfo = await bot.getFile(tgThumb.file_id);
          const thumbUrl  = `https://api.telegram.org/file/bot${BOT_TOKEN}/${thumbInfo.file_path}`;
          const thumbTmp  = `/tmp/thumb_${baseName}.jpg`;

          // Скачиваем превьюшку во временную папку
          await downloadToTmp(thumbUrl, thumbTmp);
          const thumbBuffer = fs.readFileSync(thumbTmp);

          // Загружаем в Supabase
          imageUrl = await uploadToSupabase('images', `thumb_${baseName}.jpg`, thumbBuffer, 'image/jpeg');

          // Подчищаем временный файл
          fs.unlink(thumbTmp, () => {});
        } catch (err) {
          console.warn('[Bot] Ошибка загрузки обложки из Telegram:', err.message);
        }
      }

      // Cleanup tmp
      fs.unlink(tmpPath, () => {});

      // Save to DB
      const track = await prisma.track.create({
        data: {
          title:    meta.title,
          artist:   meta.artist,
          album:    meta.album,
          genre:    meta.genre,
          duration: meta.duration,
          filename: audioUrl,
          imageUrl: imageUrl,
        },
      });

      await bot.editMessageText(
        `✅ *Track added!*\n\n🎵 ${track.title}\n👤 ${track.artist}` +
        (track.album ? `\n💿 ${track.album}` : '') +
        (track.genre ? `\n🏷 ${track.genre}` : '') +
        (imageUrl    ? `\n🖼 Cover saved` : '') +
        `\n\n_ID: ${track.id}_`,
        { chat_id: chatId, message_id: statusMsg.message_id, parse_mode: 'Markdown' }
      );

      console.log(`[Bot] Added: "${track.title}" by ${track.artist}`);

    } catch (err) {
      console.error('[Bot] Error:', err.message);
      await bot.editMessageText(`❌ Failed: ${err.message}`, {
        chat_id: chatId, message_id: statusMsg.message_id,
      }).catch(() => {});
    }
  });

  bot.on('polling_error', err => console.error('[Bot] Polling error:', err.message));
  return bot;
}

module.exports = { launch };