const fs = require('fs');
const path = require('path');

function minifyCSS(css) {
  return css
    .replace(/\/\*[\s\S]*?\*\//g, '') // Hapus komentar
    .replace(/\s+/g, ' ') // Gabungkan spasi/newline berlebih
    .replace(/\s*([\{\}\:\;\,])\s*/g, '$1') // Hapus spasi di sekitar selector & properti
    .replace(/\;+([\}])/g, '$1') // Hapus titik koma terakhir sebelum }
    .trim();
}

function minifyJS(js) {
  // Hapus block comments /* ... */
  let code = js.replace(/\/\*[\s\S]*?\*\//g, '');
  
  // Hapus single-line comments yang dimulai dari awal baris (aman dari breaking string)
  code = code.replace(/^\s*\/\/.*$/gm, '');
  
  // Hapus line comments di akhir baris secara aman
  // (Pastikan tidak menghapus protocol url seperti http:// atau https://)
  code = code.replace(/([^\:\'\"\`])\/\/.*$/gm, '$1');
  
  // Rapatkan baris kosong berlebih
  code = code.replace(/\n\s*\n+/g, '\n');
  
  return code.trim();
}

function runMinifier() {
  console.log('[MINIFIER] Menjalankan optimasi aset otomatis...');
  
  const publicDir = path.join(__dirname, '..', 'public');
  
  // Warning banners
  const bannerCSS = `/* WARNING: JANGAN EDIT FILE INI SECARA LANGSUNG. Edit main.src.css saja. File ini di-minify otomatis saat startup server. */\n`;
  const bannerJS = `// WARNING: JANGAN EDIT FILE INI SECARA LANGSUNG. Edit file .src.js yang sesuai. File ini di-minify otomatis saat startup server.\n`;

  // 1. Minify CSS
  const cssPath = path.join(publicDir, 'css', 'main.css');
  const cssSrcPath = path.join(publicDir, 'css', 'main.src.css');
  
  if (fs.existsSync(cssPath)) {
    if (!fs.existsSync(cssSrcPath)) {
      fs.copyFileSync(cssPath, cssSrcPath);
      console.log('[MINIFIER] Berhasil mencadangkan CSS asli ke main.src.css');
    }
    const cssContent = fs.readFileSync(cssSrcPath, 'utf8');
    const minified = bannerCSS + minifyCSS(cssContent);
    fs.writeFileSync(cssPath, minified, 'utf8');
    console.log(`[MINIFIER] CSS di-minify: ${cssContent.length} B -> ${minified.length} B`);
  }

  // 2. Minify main.js
  const jsMainPath = path.join(publicDir, 'js', 'main.js');
  const jsMainSrcPath = path.join(publicDir, 'js', 'main.src.js');
  
  if (fs.existsSync(jsMainPath)) {
    if (!fs.existsSync(jsMainSrcPath)) {
      fs.copyFileSync(jsMainPath, jsMainSrcPath);
      console.log('[MINIFIER] Berhasil mencadangkan main.js asli ke main.src.js');
    }
    const jsContent = fs.readFileSync(jsMainSrcPath, 'utf8');
    const minified = bannerJS + minifyJS(jsContent);
    fs.writeFileSync(jsMainPath, minified, 'utf8');
    console.log(`[MINIFIER] main.js di-minify: ${jsContent.length} B -> ${minified.length} B`);
  }

  // 3. Minify ai-engine.js
  const jsAiPath = path.join(publicDir, 'js', 'ai-engine.js');
  const jsAiSrcPath = path.join(publicDir, 'js', 'ai-engine.src.js');
  
  if (fs.existsSync(jsAiPath)) {
    if (!fs.existsSync(jsAiSrcPath)) {
      fs.copyFileSync(jsAiPath, jsAiSrcPath);
      console.log('[MINIFIER] Berhasil mencadangkan ai-engine.js asli ke ai-engine.src.js');
    }
    const jsContent = fs.readFileSync(jsAiSrcPath, 'utf8');
    const minified = bannerJS + minifyJS(jsContent);
    fs.writeFileSync(jsAiPath, minified, 'utf8');
    console.log(`[MINIFIER] ai-engine.js di-minify: ${jsContent.length} B -> ${minified.length} B`);
  }
}

module.exports = { runMinifier };
