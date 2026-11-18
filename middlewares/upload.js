const { mkdtemp, rm } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const path = require('node:path');
const multer = require('multer');
const { AUDIO_LIMIT, BATCH_LIMIT, IMAGE_LIMIT, MAX_TRACKS } = require('../services/tracks');

const uploadRoot = path.resolve(tmpdir());
const maxActiveUploads = 2;
const maxRequestSize = BATCH_LIMIT + IMAGE_LIMIT + 1024 * 1024;
let activeUploads = 0;

exports.upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, callback) => callback(null, req.trackUploadDirectory),
  }),
  limits: {
    fileSize: AUDIO_LIMIT,
    files: MAX_TRACKS,
    fields: 4,
    fieldSize: 1024,
    parts: MAX_TRACKS + 5,
  },
});

function parseUpload(parser, req, res) {
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(new Error('Track upload was aborted'));
    req.once('aborted', onAbort);
    parser(req, res, error => {
      req.removeListener('aborted', onAbort);
      if (error) reject(error);
      else resolve();
    });
  });
}

exports.withTrackUpload = (parser, handler) => async (req, res, next) => {
  const requestSize = Number(req.get('content-length'));
  if (requestSize > maxRequestSize) return res.status(413).json({ error: 'Upload exceeds the configured limit' });
  if (activeUploads >= maxActiveUploads) {
    return res.set('Retry-After', '5').status(503).json({ error: 'Track upload is busy. Try again shortly.' });
  }

  let directory;
  activeUploads++;
  try {
    directory = await mkdtemp(path.join(uploadRoot, 'underlab-tracks-'));
    if (req.aborted) return;
    req.trackUploadDirectory = directory;
    await parseUpload(parser, req, res);
    if (!req.aborted) await handler(req, res);
  } catch (error) {
    if (!req.aborted) next(error);
  } finally {
    if (directory && path.dirname(directory) === uploadRoot) {
      try {
        await rm(directory, { recursive: true, force: true, maxRetries: 3 });
      } catch (error) {
        console.warn('Temporary track cleanup failed:', error.code);
      }
    }
    activeUploads--;
  }
};

exports.uploadAvatar = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: IMAGE_LIMIT, files: 1, fields: 0 },
  fileFilter: (req, file, callback) => {
    if (!file.mimetype.startsWith('image/')) {
      return callback(new multer.MulterError('LIMIT_UNEXPECTED_FILE', file.fieldname));
    }
    callback(null, true);
  },
});
