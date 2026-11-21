const fs = require('node:fs/promises');
const path = require('node:path');
const prisma = require('../lib/prisma');
const { positiveInt } = require('../lib/validation');
const {
  IMAGE_LIMIT, TrackError, trackId, publicStorageKey, legacyName, coverUrl,
  saveTracks, updateTrack, deleteTrack,
} = require('../services/tracks');

const tracksDirectory = path.join(__dirname, '..', 'public', 'tracks');
const legacyAudioExtensions = new Set(['.mp3', '.mp2', '.flac', '.m4a', '.mp4', '.aac', '.ogg', '.oga', '.opus', '.wav', '.aiff']);
const MAX_PAGE_SIZE = 100;
const MAX_LOOKUP_IDS = 300;

function serializeTrack(track) {
  return { ...track, imageUrl: coverUrl(track.imageUrl) };
}

function sendError(res, error, message) {
  if (error instanceof TrackError) return res.status(error.status).json({ error: error.message });
  console.error(message, error.code || error.name);
  return res.status(500).json({ error: message });
}

async function getTrackPage(query, where = {}) {
  const limit = query.limit === undefined ? 40 : positiveInt(query.limit);
  const before = query.before === undefined ? undefined : positiveInt(query.before);
  if (!limit || limit > MAX_PAGE_SIZE || before === null) {
    throw new TrackError(400, 'Invalid catalog page size or cursor');
  }
  const rows = await prisma.track.findMany({
    where: before === undefined ? where : { ...where, id: { lt: before } },
    orderBy: { id: 'desc' },
    take: limit + 1,
  });
  const items = rows.slice(0, limit).map(serializeTrack);
  return { items, nextCursor: rows.length > limit ? items.at(-1).id : null };
}

function requestedPage(query) {
  return query.limit !== undefined || query.before !== undefined;
}

exports.addTrack = async (req, res) => {
  try {
    const cover = req.files?.image?.[0];
    const audio = req.files?.track?.[0];
    if (!cover || !audio) throw new TrackError(400, 'Both image and audio file are required');
    if (cover.size > IMAGE_LIMIT) throw new TrackError(413, 'Image exceeds 5 MiB');
    const image = await fs.readFile(cover.path);
    const [track] = await saveTracks([{ audio, image, overrides: req.body }]);
    res.status(201).json({ message: 'Track uploaded', track: serializeTrack(track) });
  } catch (error) {
    sendError(res, error, 'Failed to add track');
  }
};

exports.getTracks = async (req, res) => {
  try {
    if (requestedPage(req.query)) return res.json(await getTrackPage(req.query));
    const tracks = await prisma.track.findMany();
    for (let i = tracks.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [tracks[i], tracks[j]] = [tracks[j], tracks[i]];
    }
    res.json(tracks.map(serializeTrack));
  } catch (error) {
    sendError(res, error, 'Failed to get tracks');
  }
};

exports.getTracksByIds = async (req, res) => {
  const ids = typeof req.query.ids === 'string' ? req.query.ids.split(',') : [];
  if (!ids.length || ids.length > MAX_LOOKUP_IDS) {
    return res.status(400).json({ error: 'Supply up to 300 track IDs' });
  }
  const parsed = ids.map(positiveInt);
  if (parsed.includes(null)) return res.status(400).json({ error: 'Invalid track ID' });
  try {
    const tracks = await prisma.track.findMany({ where: { id: { in: [...new Set(parsed)] } } });
    return res.json(tracks.map(serializeTrack));
  } catch (error) {
    return sendError(res, error, 'Failed to look up tracks');
  }
};

exports.streamTrack = async (req, res, next) => {
  try {
    const id = trackId(req.params.id);
    const track = await prisma.track.findUnique({ where: { id } });
    if (!track) throw new TrackError(404, 'Track not found');
    res.set('X-Content-Type-Options', 'nosniff');
    if (publicStorageKey(track.filename, 'tracks')) {
      return res.redirect(302, track.filename);
    }

    const name = legacyName(track.filename, 'tracks');
    if (!name || !legacyAudioExtensions.has(path.extname(name).toLowerCase())) {
      throw new TrackError(404, 'Audio file not found');
    }
    const file = await fs.lstat(path.join(tracksDirectory, name)).catch(error => {
      if (error.code === 'ENOENT') return null;
      throw error;
    });
    if (!file?.isFile()) throw new TrackError(404, 'Audio file not found');
    return res.sendFile(name, { root: tracksDirectory, dotfiles: 'deny' }, error => {
      if (!error || res.destroyed || error.code === 'ECONNABORTED') return;
      if (res.headersSent) return next(error);
      if (error.status === 416) {
        res.set('Content-Range', `bytes */${file.size}`);
        return res.status(416).end();
      }
      const status = error.status === 404 ? 404 : 500;
      return res.status(status).json({ error: status === 404 ? 'Audio file not found' : 'Failed to stream track' });
    });
  } catch (error) {
    sendError(res, error, 'Failed to stream track');
  }
};

exports.search = async (req, res) => {
  const query = typeof req.query.query === 'string' ? req.query.query.trim() : '';
  if (!query) return res.status(400).json({ error: 'Query parameter required' });
  if (query.length > 300) return res.status(400).json({ error: 'Query is too long' });
  const searchTerm = query.replace(/[\\%_]/g, '\\$&');
  try {
    const where = {
      OR: ['title', 'artist', 'album'].map(field => ({
        [field]: { contains: searchTerm, mode: 'insensitive' },
      })),
    };
    if (requestedPage(req.query)) return res.json(await getTrackPage(req.query, where));
    const tracks = await prisma.track.findMany({ where });
    res.json(tracks.map(serializeTrack));
  } catch (error) {
    sendError(res, error, 'Search failed');
  }
};

exports.uploadMultipleTracks = async (req, res) => {
  try {
    if (!req.files?.length) throw new TrackError(400, 'No files provided');
    const tracks = await saveTracks(req.files.map(audio => ({ audio })));
    res.status(201).json({ message: 'Tracks uploaded', tracks: tracks.map(serializeTrack) });
  } catch (error) {
    sendError(res, error, 'Bulk upload failed');
  }
};

exports.editTrack = async (req, res) => {
  try {
    const track = await updateTrack(req.params.id, req.body || {});
    res.status(200).json({ message: 'Track updated', track: serializeTrack(track) });
  } catch (error) {
    sendError(res, error, 'Failed to update track');
  }
};

exports.deleteTrack = async (req, res) => {
  try {
    await deleteTrack(req.params.id);
    res.status(200).json({ message: 'Track deleted' });
  } catch (error) {
    sendError(res, error, 'Failed to delete track');
  }
};
