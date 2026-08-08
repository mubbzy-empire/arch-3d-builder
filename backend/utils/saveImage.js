const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const uploadDir = path.join(__dirname, '..', 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const EXT_BY_MIME = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp' };

function saveRenderImage(image) {
  if (!image || !image.base64) return null;
  const ext = EXT_BY_MIME[image.mimeType] || '.png';
  const filename = `render-${uuidv4()}${ext}`;
  fs.writeFileSync(path.join(uploadDir, filename), Buffer.from(image.base64, 'base64'));
  return `/uploads/${filename}`;
}

module.exports = { saveRenderImage, uploadDir };
