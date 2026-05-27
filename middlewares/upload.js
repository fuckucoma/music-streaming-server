const multer = require('multer');

// Memory storage — files go to Supabase, not local disk
const memoryStorage = multer.memoryStorage();

const audioFilter = (req, file, cb) => {
  const allowed = ['audio/mpeg', 'audio/mp3', 'audio/flac', 'audio/ogg',
                   'audio/wav', 'audio/x-wav', 'audio/aac', 'audio/mp4',
                   'audio/x-m4a', 'video/mp4'];
  if (allowed.includes(file.mimetype) || file.mimetype.startsWith('audio/')) {
    cb(null, true);
  } else {
    cb(new Error(`Unsupported audio type: ${file.mimetype}`), false);
  }
};

const imageFilter = (req, file, cb) => {
  if (file.mimetype.startsWith('image/')) {
    cb(null, true);
  } else {
    cb(new Error('Only image files allowed'), false);
  }
};

// Track uploads (audio + optional image)
exports.upload = multer({
  storage: memoryStorage,
  limits: { fileSize: 100 * 1024 * 1024 }, // 100MB
  fileFilter: (req, file, cb) => {
    if (file.fieldname === 'image') return imageFilter(req, file, cb);
    return audioFilter(req, file, cb);
  },
});

// Avatar uploads
exports.uploadAvatar = multer({
  storage: memoryStorage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
  fileFilter: imageFilter,
});