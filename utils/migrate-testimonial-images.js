/**
 * Migration script: Extract base64-encoded testimonial images from db.json
 * and save them as physical files in public/uploads/testimonials/.
 * 
 * Run once: node utils/migrate-testimonial-images.js
 */
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const DB_PATH = path.join(__dirname, '..', 'database', 'db.json');
const UPLOADS_DIR = path.join(__dirname, '..', 'public', 'uploads', 'testimonials');

function migrate() {
  console.log('[MIGRATE] Starting testimonial image migration...');

  if (!fs.existsSync(DB_PATH)) {
    console.log('[MIGRATE] db.json not found. Nothing to migrate.');
    return;
  }

  // Ensure uploads directory exists
  if (!fs.existsSync(UPLOADS_DIR)) {
    fs.mkdirSync(UPLOADS_DIR, { recursive: true });
  }

  const raw = fs.readFileSync(DB_PATH, 'utf8');
  const data = JSON.parse(raw);

  if (!data.testimonials || !Array.isArray(data.testimonials)) {
    console.log('[MIGRATE] No testimonials array found. Nothing to migrate.');
    return;
  }

  let migrated = 0;

  data.testimonials.forEach((testi, idx) => {
    if (testi.image && typeof testi.image === 'string' && testi.image.startsWith('data:image/')) {
      // Extract mime type and base64 data
      const match = testi.image.match(/^data:image\/(\w+);base64,(.+)$/);
      if (!match) {
        console.warn(`[MIGRATE] Skipping testimonial "${testi.name}" — invalid base64 format.`);
        return;
      }

      const ext = match[1] === 'jpeg' ? 'jpg' : match[1];
      const base64Data = match[2];
      const fileName = `testi-${uuidv4()}.${ext}`;
      const filePath = path.join(UPLOADS_DIR, fileName);

      // Write the file
      fs.writeFileSync(filePath, Buffer.from(base64Data, 'base64'));

      // Update the testimonial to use the file path
      data.testimonials[idx].image = `/uploads/testimonials/${fileName}`;
      migrated++;

      console.log(`[MIGRATE] Extracted image for "${testi.name}" → ${fileName}`);
    }
  });

  if (migrated > 0) {
    // Write updated db.json back
    fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2), 'utf8');
    console.log(`[MIGRATE] Done! Migrated ${migrated} testimonial image(s) from base64 to files.`);
  } else {
    console.log('[MIGRATE] No base64 images found. Nothing to migrate.');
  }
}

migrate();
