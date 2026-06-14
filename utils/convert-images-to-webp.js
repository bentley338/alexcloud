/**
 * Convert game cover images from PNG/JPG to WebP format.
 * Reduces file size by 70-80% without visible quality loss.
 *
 * Prerequisite: npm install sharp
 * Run: node utils/convert-images-to-webp.js
 */
const fs = require('fs');
const path = require('path');

const IMAGES_DIR = path.join(__dirname, '..', 'public', 'images', 'games');

async function convert() {
  let sharp;
  try {
    sharp = require('sharp');
  } catch (e) {
    console.error('[CONVERT] sharp is not installed. Run: npm install sharp');
    console.error('[CONVERT] Skipping WebP conversion.');
    return;
  }

  if (!fs.existsSync(IMAGES_DIR)) {
    console.log('[CONVERT] Images directory not found. Nothing to convert.');
    return;
  }

  const files = fs.readdirSync(IMAGES_DIR).filter(f =>
    /\.(png|jpg|jpeg)$/i.test(f) && !f.endsWith('.webp')
  );

  if (files.length === 0) {
    console.log('[CONVERT] No PNG/JPG files to convert. All done!');
    return;
  }

  console.log(`[CONVERT] Found ${files.length} image(s) to convert to WebP...`);
  let converted = 0;

  for (const file of files) {
    const inputPath = path.join(IMAGES_DIR, file);
    const baseName = path.basename(file, path.extname(file));
    const outputPath = path.join(IMAGES_DIR, `${baseName}.webp`);

    try {
      const info = await sharp(inputPath)
        .webp({ quality: 82, effort: 4 })
        .toFile(outputPath);

      const oldSize = fs.statSync(inputPath).size;
      const savings = Math.round((1 - info.size / oldSize) * 100);
      console.log(`[CONVERT] ${file} -> ${baseName}.webp (${oldSize} -> ${info.size} bytes, -${savings}%)`);
      converted++;
    } catch (e) {
      console.error(`[CONVERT] Failed to convert ${file}:`, e.message);
    }
  }

  console.log(`[CONVERT] Done! Converted ${converted}/${files.length} images.`);
  console.log('[CONVERT] Now update gameImageMapping in database/db.js to use .webp extensions.');
}

convert();
