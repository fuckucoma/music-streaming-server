const { randomUUID } = require('node:crypto');
const { createReadStream } = require('node:fs');
const path = require('node:path');
const prisma = require('../lib/prisma');
const { positiveInt } = require('../lib/validation');
const { detectImageType } = require('./images');

const AUDIO_LIMIT = 100 * 1024 * 1024;
const IMAGE_LIMIT = 5 * 1024 * 1024;
const BATCH_LIMIT = 200 * 1024 * 1024;
const MAX_TRACKS = 5;
const TEXT_LIMIT = 300;

class TrackError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function trackId(value) {
  const id = positiveInt(value);
  if (id === null) throw new TrackError(400, 'Invalid track ID');
  return id;
}

function trackText(value) {
  return typeof value === 'string' ? value.trim().slice(0, TEXT_LIMIT) : '';
}

function normalizeDuration(value) {
  return Number.isFinite(value) && value > 0 && value <= 2147483647 ? Math.round(value) : null;
}

function audioDetails(format) {
  if (format.hasVideo || !format.sampleRate || !format.numberOfChannels) return null;
  const { container = '', codec = '' } = format;
  if (/^MPEG.*Layer (?:I{1,3}|[123])\b/i.test(codec)) return { extension: '.mp3', contentType: 'audio/mpeg' };
  if (container === 'FLAC') return { extension: '.flac', contentType: 'audio/flac' };
  if (container === 'Ogg' && /Vorbis|Opus|Speex|FLAC/i.test(codec)) return { extension: '.ogg', contentType: 'audio/ogg' };
  if (container === 'WAVE') return { extension: '.wav', contentType: 'audio/wav' };
  if (/^ADTS\b/i.test(container)) return { extension: '.aac', contentType: 'audio/aac' };
  if (/(?:AAC|ALAC)/i.test(codec)) return { extension: '.m4a', contentType: 'audio/mp4' };
  return null;
}

function inspectImage(buffer, required = false) {
  if (Buffer.isBuffer(buffer) && buffer.length > IMAGE_LIMIT && required) {
    throw new TrackError(413, 'Image exceeds 5 MiB');
  }
  const details = Buffer.isBuffer(buffer) && buffer.length <= IMAGE_LIMIT && detectImageType(buffer);
  if (details) return { buffer, ...details };
  if (required) throw new TrackError(400, 'Unsupported image file');
  return null;
}

async function prepareTrack({ audio, image, overrides = {}, fallback = {}, loadFallbackCover }) {
  if (!audio?.size) throw new TrackError(400, 'Audio file required');
  if (audio.size > AUDIO_LIMIT) throw new TrackError(413, 'Audio file exceeds 100 MiB');

  let info;
  try {
    const metadata = await import('music-metadata');
    info = audio.path
      ? await metadata.parseFile(audio.path, { duration: true })
      : await metadata.parseBuffer(audio.buffer, undefined, { duration: true });
  } catch {
    throw new TrackError(400, 'Invalid or unsupported audio file');
  }

  const details = audioDetails(info.format);
  if (!details) throw new TrackError(400, 'Unsupported audio format');
  const source = audio.originalname || '';
  const name = path.parse(path.win32.basename(source)).name;
  const tags = info.common;
  const cover = image
    ? inspectImage(image, true)
    : tags.picture?.map(item => inspectImage(Buffer.from(item.data.buffer, item.data.byteOffset, item.data.byteLength))).find(Boolean);
  const fallbackCover = !cover && loadFallbackCover ? await loadFallbackCover() : null;

  return {
    audio: { ...audio, ...details },
    cover: cover || inspectImage(fallbackCover),
    data: {
      title: trackText(overrides.title) || trackText(tags.title) || trackText(fallback.title) || trackText(name) || 'Unknown',
      artist: trackText(overrides.artist) || trackText(tags.artist) || trackText(fallback.artist) || 'Unknown',
      album: trackText(overrides.album) || trackText(tags.album) || null,
      genre: trackText(overrides.genre) || trackText(tags.genre?.[0]) || null,
      duration: normalizeDuration(info.format.duration) ?? normalizeDuration(fallback.duration),
    },
  };
}

function bucket(name) {
  return require('../lib/supabase').storage.from(name);
}

function publicStorageKey(value, bucketName) {
  if (typeof value !== 'string' || !process.env.SUPABASE_URL) return null;
  try {
    const source = new URL(value);
    const base = new URL(process.env.SUPABASE_URL);
    const prefix = `${base.pathname.replace(/\/$/, '')}/storage/v1/object/public/${bucketName}/`;
    if (source.origin !== base.origin || source.username || source.password || !source.pathname.startsWith(prefix)) return null;
    const parts = source.pathname.slice(prefix.length).split('/').map(decodeURIComponent);
    if (parts.some(part => !part || part === '.' || part === '..' || /[\\/\x00-\x1f]/.test(part))) return null;
    if (bucketName === 'images' && parts[0] === 'avatars') return null;
    return parts.join('/');
  } catch {
    return null;
  }
}

async function removeObjects(objects) {
  for (const { name, key } of objects) {
    try {
      const { error } = await bucket(name).remove([key]);
      if (error) throw error;
    } catch (error) {
      console.warn('Track storage cleanup failed', { bucket: name, key, message: error.message });
    }
  }
}

async function uploadObject(name, key, file, attempted) {
  const storage = bucket(name);
  attempted.push({ name, key });
  const stream = file.path ? createReadStream(file.path) : null;
  try {
    const { error } = await storage.upload(key, stream || file.buffer, {
      contentType: file.contentType,
      upsert: false,
    });
    if (error) throw error;
    return storage.getPublicUrl(key).data.publicUrl;
  } finally {
    stream?.destroy();
  }
}

async function saveTracks(inputs) {
  if (!inputs.length || inputs.length > MAX_TRACKS) throw new TrackError(400, 'Invalid track count');
  if (inputs.reduce((total, input) => total + (input.audio?.size || 0), 0) > BATCH_LIMIT) {
    throw new TrackError(413, 'Total audio size exceeds 200 MiB');
  }

  const attempted = [];
  try {
    const records = [];
    for (const input of inputs) {
      const { audio, cover, data } = await prepareTrack(input);
      const name = randomUUID();
      const filename = await uploadObject('tracks', name + audio.extension, audio, attempted);
      const imageUrl = cover ? await uploadObject('images', name + cover.extension, cover, attempted) : null;
      records.push({ ...data, filename, imageUrl });
    }
    if (records.length === 1) return [await prisma.track.create({ data: records[0] })];
    return await prisma.$transaction(records.map(data => prisma.track.create({ data })));
  } catch (error) {
    await removeObjects(attempted);
    throw error;
  }
}

function legacyName(value, directory) {
  if (typeof value !== 'string') return null;
  const prefix = new RegExp(`^/?(?:public/)?${directory}/`);
  const name = value.replace(/\\/g, '/').replace(prefix, '');
  if (!name || name.startsWith('.') || /[\\/:*?"<>|\x00-\x1f]/.test(name) || /[. ]$/.test(name)) return null;
  return name;
}

function coverUrl(value) {
  if (typeof value === 'string' && /^https?:\/\//i.test(value)) return value;
  const name = legacyName(value, 'images');
  return name ? `/images/${encodeURIComponent(name)}` : null;
}

async function updateTrack(value, fields) {
  const id = trackId(value);
  const data = {};
  for (const field of ['title', 'artist', 'album', 'genre']) {
    const value = fields[field];
    if (value === undefined) continue;
    const nullable = field === 'album' || field === 'genre';
    if (value === null && nullable) {
      data[field] = null;
      continue;
    }
    if (typeof value !== 'string' || value.trim().length > TEXT_LIMIT || (!nullable && !value.trim())) {
      throw new TrackError(400, `Invalid ${field}`);
    }
    data[field] = value.trim() || null;
  }
  try {
    return await prisma.track.update({ where: { id }, data });
  } catch (error) {
    if (error.code === 'P2025') throw new TrackError(404, 'Track not found');
    throw error;
  }
}

async function deleteTrack(value) {
  const id = trackId(value);
  let track;
  try {
    track = await prisma.$transaction(async tx => {
      await tx.favorite.deleteMany({ where: { trackId: id } });
      await tx.review.deleteMany({ where: { trackId: id } });
      return tx.track.delete({ where: { id } });
    });
  } catch (error) {
    if (error.code === 'P2025') throw new TrackError(404, 'Track not found');
    throw error;
  }
  const audio = publicStorageKey(track.filename, 'tracks');
  const cover = publicStorageKey(track.imageUrl, 'images');
  const objects = [];
  if (audio) objects.push({ name: 'tracks', key: audio });
  if (cover) objects.push({ name: 'images', key: cover });
  await removeObjects(objects);
}

module.exports = {
  AUDIO_LIMIT, BATCH_LIMIT, IMAGE_LIMIT, MAX_TRACKS,
  TrackError, trackId, publicStorageKey, legacyName, coverUrl, saveTracks, updateTrack, deleteTrack,
};
