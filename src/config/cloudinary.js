// src/config/cloudinary.js — persistent product image storage
const crypto = require('crypto');
const fs = require('fs/promises');
const path = require('path');

function hasCloudinaryConfig() {
  return Boolean(
    process.env.CLOUDINARY_CLOUD_NAME &&
    process.env.CLOUDINARY_API_KEY &&
    process.env.CLOUDINARY_API_SECRET
  );
}

function signUpload(params, apiSecret) {
  const payload = Object.keys(params)
    .sort()
    .map((key) => `${key}=${params[key]}`)
    .join('&');
  return crypto.createHash('sha1').update(`${payload}${apiSecret}`).digest('hex');
}

async function saveLocalFallback(file) {
  const uploadDir = process.env.UPLOAD_PATH || 'uploads';
  await fs.mkdir(uploadDir, { recursive: true });
  const ext = path.extname(file.originalname || '') || '.jpg';
  const filename = `${Date.now()}-${Math.round(Math.random() * 1e6)}${ext}`;
  await fs.writeFile(path.join(uploadDir, filename), file.buffer);
  return filename;
}

async function uploadToCloudinary(file) {
  if (!file) return null;
  if (!hasCloudinaryConfig()) return saveLocalFallback(file);

  const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
  const apiKey = process.env.CLOUDINARY_API_KEY;
  const apiSecret = process.env.CLOUDINARY_API_SECRET;
  const timestamp = Math.round(Date.now() / 1000);
  const folder = process.env.CLOUDINARY_FOLDER || 'krishokbazar/products';
  const signature = signUpload({ folder, timestamp }, apiSecret);

  const form = new FormData();
  form.append('file', new Blob([file.buffer], { type: file.mimetype }), file.originalname);
  form.append('api_key', apiKey);
  form.append('timestamp', `${timestamp}`);
  form.append('folder', folder);
  form.append('signature', signature);

  const res = await fetch(`https://api.cloudinary.com/v1_1/${cloudName}/image/upload`, {
    method: 'POST',
    body: form,
  });
  const body = await res.json();
  if (!res.ok) {
    throw new Error(body?.error?.message || 'Cloudinary upload failed');
  }

  return body.secure_url;
}

module.exports = { uploadToCloudinary, hasCloudinaryConfig };
