// src/middleware/upload.js — Multer File Upload
const multer = require('multer');
const path   = require('path');

const fileFilter = (req, file, cb) => {
  const allowed = /jpeg|jpg|png|webp/;
  const extOk = allowed.test(path.extname(file.originalname).toLowerCase());
  const mimeOk = /^image\/(jpeg|jpg|png|webp)$/.test(file.mimetype);
  if (extOk && mimeOk) cb(null, true);
  else cb(new Error('শুধু JPG, PNG, WEBP ছবি দেওয়া যাবে।'));
};

const upload = multer({
  storage: multer.memoryStorage(),
  fileFilter,
  limits: { fileSize: parseInt(process.env.MAX_FILE_SIZE) || 5 * 1024 * 1024 },
});

module.exports = upload;
