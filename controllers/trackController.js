const { PrismaClient } = require('@prisma/client');
const path   = require('path');
const fs     = require('fs');
const prisma = new PrismaClient();
const mm     = require('music-metadata');
const supabase = require('../lib/supabase');
require('dotenv').config();

const SUPABASE_URL = process.env.SUPABASE_URL;

// ── Helpers ───────────────────────────────────────────────────

/** Upload a local file buffer to Supabase Storage, return public URL */
async function uploadToSupabase(bucket, storagePath, fileBuffer, contentType) {
  const { error } = await supabase.storage
    .from(bucket)
    .upload(storagePath, fileBuffer, {
      contentType,
      upsert: true,
    });
  if (error) throw new Error(`Supabase upload failed: ${error.message}`);
  return `${SUPABASE_URL}/storage/v1/object/public/${bucket}/${storagePath}`;
}

/** Delete a file from Supabase Storage by its storage path */
async function deleteFromSupabase(bucket, storagePath) {
  if (!storagePath) return;
  await supabase.storage.from(bucket).remove([storagePath]).catch(() => {});
}

/** Extract storage path from a full Supabase public URL */
function extractStoragePath(publicUrl, bucket) {
  if (!publicUrl) return null;
  const marker = `/object/public/${bucket}/`;
  const idx = publicUrl.indexOf(marker);
  return idx !== -1 ? publicUrl.slice(idx + marker.length) : null;
}

/** Extract cover art from audio file, return buffer + mime */
async function extractCoverBuffer(filePath) {
  try {
    const metadata = await mm.parseFile(filePath, { skipCovers: false });
    const pic = metadata.common.picture?.[0];
    if (!pic) return null;
    return { buffer: pic.data, mime: pic.format?.includes('png') ? 'image/png' : 'image/jpeg' };
  } catch {
    return null;
  }
}

/** Extract audio metadata from file */
async function extractMetadata(filePath, fallbackTitle) {
  try {
    const metadata = await mm.parseFile(filePath);
    return {
      title:    metadata.common.title   ?? fallbackTitle,
      artist:   metadata.common.artist  ?? 'Unknown',
      album:    metadata.common.album   ?? null,
      genre:    metadata.common.genre?.[0] ?? null,
      duration: metadata.format.duration ? Math.round(metadata.format.duration) : null,
    };
  } catch {
    return { title: fallbackTitle, artist: 'Unknown', album: null, genre: null, duration: null };
  }
}

// ── Controllers ───────────────────────────────────────────────

exports.addTrack = async (req, res) => {
  try {
    const { title, artist } = req.body;
    const imageFile = req.files?.['image']?.[0] ?? null;
    const audioFile = req.files?.['track']?.[0] ?? null;

    if (!imageFile || !audioFile) {
      return res.status(400).json({ error: 'Both image and audio file are required' });
    }

    const baseName   = `${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const audioExt   = path.extname(audioFile.originalname) || '.mp3';
    const imageExt   = path.extname(imageFile.originalname) || '.jpg';
    const audioPath  = `${baseName}${audioExt}`;
    const imagePath  = `${baseName}${imageExt}`;

    const [audioUrl, imageUrl] = await Promise.all([
      uploadToSupabase('tracks', audioPath, audioFile.buffer, audioFile.mimetype),
      uploadToSupabase('images', imagePath, imageFile.buffer, imageFile.mimetype),
    ]);

    const track = await prisma.track.create({
      data: { title, artist, filename: audioUrl, imageUrl },
    });

    res.status(201).json({ message: 'Track uploaded', track });
  } catch (error) {
    console.error('addTrack error:', error);
    res.status(500).json({ error: 'Failed to add track' });
  }
};

exports.getTracks = async (req, res) => {
  try {
    const tracks = await prisma.track.findMany();

    // Shuffle (Fisher-Yates)
    for (let i = tracks.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [tracks[i], tracks[j]] = [tracks[j], tracks[i]];
    }

    res.json(tracks);
  } catch (error) {
    console.error('getTracks error:', error.message);
    res.status(500).json({ error: 'Failed to get tracks' });
  }
};

exports.streamTrack = async (req, res) => {
  try {
    const track = await prisma.track.findUnique({
      where: { id: parseInt(req.params.id) },
    });
    if (!track) return res.status(404).json({ error: 'Track not found' });

    // filename is now a full Supabase public URL — redirect to it
    // The browser/audio element will stream directly from Supabase CDN
    return res.redirect(302, track.filename);
  } catch (error) {
    console.error('streamTrack error:', error);
    res.status(500).json({ error: 'Failed to stream track' });
  }
};

exports.search = async (req, res) => {
  try {
    const { query } = req.query;
    if (!query) return res.status(400).json({ error: 'Query parameter required' });

    const tracks = await prisma.track.findMany({
      where: {
        OR: [
          { title:  { contains: query, mode: 'insensitive' } },
          { artist: { contains: query, mode: 'insensitive' } },
        ],
      },
    });

    res.json(tracks);
  } catch (error) {
    console.error('search error:', error.message);
    res.status(500).json({ error: 'Search failed' });
  }
};

exports.uploadMultipleTracks = async (req, res) => {
  try {
    const files = req.files;
    if (!files?.length) return res.status(400).json({ error: 'No files provided' });

    const uploaded = [];

    for (const file of files) {
      const baseName  = `${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
      const ext       = path.extname(file.originalname).toLowerCase() || '.mp3';
      const audioPath = `${baseName}${ext}`;

      // Write temp file for metadata extraction
      const tmpPath = `/tmp/${baseName}${ext}`;
      fs.writeFileSync(tmpPath, file.buffer);

      let meta     = { title: path.parse(file.originalname).name, artist: 'Unknown', album: null, genre: null, duration: null };
      let imageUrl = null;

      try {
        meta = await extractMetadata(tmpPath, meta.title);
        const cover = await extractCoverBuffer(tmpPath);
        if (cover) {
          const imgExt  = cover.mime === 'image/png' ? 'png' : 'jpg';
          const imgPath = `${baseName}.${imgExt}`;
          imageUrl = await uploadToSupabase('images', imgPath, cover.buffer, cover.mime);
        }
      } catch (err) {
        console.warn(`Metadata extraction failed for ${file.originalname}:`, err.message);
      } finally {
        fs.unlink(tmpPath, () => {});
      }

      const audioUrl = await uploadToSupabase('tracks', audioPath, file.buffer, file.mimetype);

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

      uploaded.push(track);
    }

    res.status(201).json({ message: 'Tracks uploaded', tracks: uploaded });
  } catch (error) {
    console.error('uploadMultipleTracks error:', error);
    res.status(500).json({ error: 'Bulk upload failed' });
  }
};

exports.editTrack = async (req, res) => {
  if (!req.user?.isAdmin) return res.status(403).json({ error: 'Forbidden' });

  const { title, artist, album, genre } = req.body;
  try {
    const updated = await prisma.track.update({
      where: { id: parseInt(req.params.id) },
      data: { title, artist, album, genre },
    });
    res.status(200).json({ message: 'Track updated', track: updated });
  } catch (error) {
    console.error('editTrack error:', error);
    res.status(500).json({ error: 'Failed to update track' });
  }
};

exports.deleteTrack = async (req, res) => {
  try {
    const track = await prisma.track.findUnique({ where: { id: parseInt(req.params.id) } });
    if (!track) return res.status(404).json({ error: 'Track not found' });

    await prisma.track.delete({ where: { id: track.id } });

    // Delete files from Supabase Storage
    await Promise.all([
      deleteFromSupabase('tracks', extractStoragePath(track.filename, 'tracks')),
      deleteFromSupabase('images', extractStoragePath(track.imageUrl, 'images')),
    ]);

    res.status(200).json({ message: 'Track deleted' });
  } catch (error) {
    console.error('deleteTrack error:', error.message);
    res.status(500).json({ error: 'Failed to delete track' });
  }
};