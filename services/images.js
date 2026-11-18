const PNG_HEADER = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const WEBP_CHUNKS = new Set(['VP8 ', 'VP8L', 'VP8X']);

function detectImageType(buffer) {
  if (!Buffer.isBuffer(buffer)) return null;
  if (buffer.length >= 4 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return { contentType: 'image/jpeg', extension: '.jpg' };
  }
  if (buffer.length >= 24 && buffer.subarray(0, 8).equals(PNG_HEADER) && buffer.toString('ascii', 12, 16) === 'IHDR') {
    return { contentType: 'image/png', extension: '.png' };
  }
  const gifHeader = buffer.toString('ascii', 0, 6);
  if (buffer.length >= 13 && (gifHeader === 'GIF87a' || gifHeader === 'GIF89a')) {
    return { contentType: 'image/gif', extension: '.gif' };
  }
  if (buffer.length >= 16 && buffer.toString('ascii', 0, 4) === 'RIFF' &&
      buffer.toString('ascii', 8, 12) === 'WEBP' && WEBP_CHUNKS.has(buffer.toString('ascii', 12, 16))) {
    return { contentType: 'image/webp', extension: '.webp' };
  }
  return null;
}

module.exports = { detectImageType };
