const fs = require('fs');

const testiPath = '/var/www/botwa/commands/owner/testi.js';
let content = fs.readFileSync(testiPath, 'utf8');

// The current axios.post call has x-api-key in headers.
// We need to:
// 1. Move secret to request body instead of headers
// 2. Remove x-api-key header

// Strategy: Replace the axios.post block
// Old pattern:
//   const response = await axios.post(`${config.websiteUrl}/api/testimonials`, {
//       name: testiName,
//       role: "Customer AlexCloud",
//       text: testiText,
//       rating: testiRating,
//       image: testiImageBase64 || null
//   }, {
//       headers: {
//           'x-api-key': config.testimonialApiKey,   <-- REMOVE THIS
//           'Content-Type': 'application/json'
//       },
//
// New pattern: send secret in body, no x-api-key header

const oldPattern = `const response = await axios.post(\`\${config.websiteUrl}/api/testimonials\`, {
                name: testiName,
                role: "Customer AlexCloud",
                text: testiText,
                rating: testiRating,
                image: testiImageBase64 || null
            }, {
                headers: {
                    'x-api-key': config.testimonialApiKey,
                    'Content-Type': 'application/json'
                },`;

const newPattern = `const response = await axios.post(\`\${config.websiteUrl}/api/testimonials\`, {
                secret: process.env.BOT_SHARED_SECRET || 'alexcloud-botwa-secret-2026',
                name: testiName,
                role: "Customer AlexCloud",
                text: testiText,
                rating: testiRating,
                image: testiImageBase64 || null
            }, {
                headers: {
                    'Content-Type': 'application/json'
                },`;

if (content.includes(oldPattern)) {
  content = content.replace(oldPattern, newPattern);
  fs.writeFileSync(testiPath, content);
  console.log('✅ SUCCESS: testi.js patched! Removed x-api-key header, added secret to body.');
} else {
  // Try a more flexible approach - find and replace line by line
  console.log('Pattern not found exactly. Trying flexible approach...');
  
  const lines = content.split('\n');
  let patchedLines = [];
  let inAxiosPost = false;
  let bodyInserted = false;
  let apiKeyLineRemoved = false;
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    
    // Detect start of our axios.post call
    if (line.includes("axios.post") && line.includes('/api/testimonials')) {
      inAxiosPost = true;
      patchedLines.push(line);
      continue;
    }
    
    if (inAxiosPost) {
      // Skip the x-api-key header line
      if (line.includes("x-api-key") || line.includes("testimonialApiKey")) {
        apiKeyLineRemoved = true;
        console.log(`Removed line ${i+1}: ${line.trim()}`);
        continue; // skip this line
      }
      
      // Insert secret in body - after the opening brace of the body
      if (!bodyInserted && line.includes('name: testiName')) {
        patchedLines.push(`                secret: process.env.BOT_SHARED_SECRET || 'alexcloud-botwa-secret-2026',`);
        bodyInserted = true;
        console.log(`Inserted secret line before line ${i+1}`);
      }
      
      // End of axios call
      if (line.includes('maxContentLength:')) {
        inAxiosPost = false;
      }
    }
    
    patchedLines.push(line);
  }
  
  if (apiKeyLineRemoved || bodyInserted) {
    fs.writeFileSync(testiPath, patchedLines.join('\n'));
    console.log(`✅ SUCCESS: Patched with flexible approach. apiKeyRemoved=${apiKeyLineRemoved}, secretInserted=${bodyInserted}`);
  } else {
    console.log('❌ FAILED: Could not patch testi.js. Printing relevant section for debugging:');
    lines.forEach((line, idx) => {
      if (idx >= 100 && idx <= 125) {
        console.log(`${idx + 1}: ${line}`);
      }
    });
  }
}

process.exit(0);
