const { Pool } = require('pg');

// Use env from .env if running locally or default to VPS connection
const dotenv = require('dotenv');
dotenv.config();

const DATABASE_URL = process.env.DATABASE_URL || 'postgresql://alexuser:alexdbsecure123@localhost:5432/alexcloud';

function cleanQuery(name) {
  let query = name;
  
  // Replace curly apostrophes and quotes
  query = query.replace(/[’'‘’]/g, "'");
  query = query.replace(/[“”"”]/g, '"');
  
  // Split on en/em-dashes
  if (query.includes('—')) {
    query = query.split('—')[1].trim();
  } else if (query.includes('–')) {
    query = query.split('–')[1].trim();
  }
  
  // Clean parenthesis content like "(20 games)", "(re-launch)"
  query = query.replace(/\(.*?\)/g, '').trim();

  // Clean specific suffixes ONLY as standalone words (using word boundaries)
  query = query.replace(/\b(EE|Director’s Cut|Enhanced Edition|Definitive Edition|Terminal Cut|Ultimate Edition|Gold Edition|Collector’s Edition|Anniversary Edition|Anniversary Collection|Complete)\b/gi, '').trim();

  // If there's a colon or a dash, try splitting or removing the subtitle
  query = query.replace(/:/g, ' ');

  // Collapse multiple spaces
  query = query.replace(/\s+/g, ' ').trim();
  
  return query;
}

async function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function checkUrl(url) {
  if (!url || !url.startsWith('http')) return false;
  try {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), 4000);
    const resp = await fetch(url, { method: 'HEAD', signal: controller.signal });
    clearTimeout(id);
    return resp.status === 200;
  } catch (e) {
    return false;
  }
}

async function searchSteam(name) {
  const cleaned = cleanQuery(name);
  try {
    const url = 'https://store.steampowered.com/api/storesearch/?term=' + encodeURIComponent(cleaned) + '&l=english&cc=US';
    const resp = await fetch(url);
    if (!resp.ok) return null;
    const data = await resp.json();
    if (data && data.items && data.items.length > 0) {
      return data.items[0];
    }
  } catch (e) {
    console.error(`Steam API error for "${name}":`, e.message);
  }
  return null;
}

async function run() {
  const pool = new Pool({ connectionString: DATABASE_URL, ssl: false });
  console.log('Connecting to database...');
  
  try {
    const dbRes = await pool.query("SELECT value FROM app_state WHERE key = 'main'");
    if (dbRes.rows.length === 0) {
      console.error('No state found in database!');
      return;
    }
    
    const state = dbRes.rows[0].value;
    const games = state.games || [];
    console.log(`Loaded ${games.length} games from database.`);
    
    let updatedCount = 0;
    
    for (let i = 0; i < games.length; i++) {
      const game = games[i];
      const isPlaceholder = !game.image || game.image.includes('placehold.co');
      
      let needsFix = false;
      
      if (isPlaceholder) {
        needsFix = true;
        console.log(`[CHECK] "${game.name}" is using a placeholder. Re-searching...`);
      } else {
        // Verify if the Steam URL is active
        const isOk = await checkUrl(game.image);
        if (!isOk) {
          needsFix = true;
          console.log(`[CHECK] "${game.name}" cover returns 404/error. Re-searching...`);
        }
      }
      
      if (needsFix) {
        const match = await searchSteam(game.name);
        if (match) {
          const retinaUrl = `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${match.id}/library_600x900_2x.jpg`;
          const standardUrl = `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${match.id}/library_600x900.jpg`;
          
          console.log(`Found Steam match for "${game.name}" -> ${match.name} (App ID: ${match.id})`);
          
          // Verify vertical cover availability
          const hasRetina = await checkUrl(retinaUrl);
          if (hasRetina) {
            game.image = retinaUrl;
            console.log(`  -> Set retina cover: ${retinaUrl}`);
          } else {
            const hasStandard = await checkUrl(standardUrl);
            if (hasStandard) {
              game.image = standardUrl;
              console.log(`  -> Set standard cover: ${standardUrl}`);
            } else {
              // Fallback to placeholder (EJS template will render as beautiful gradient card)
              game.image = `https://placehold.co/600x900?text=${encodeURIComponent(game.name)}`;
              console.log(`  -> No vertical cover on Steam. Using placeholder.`);
            }
          }
          updatedCount++;
        } else {
          console.log(`  -> No Steam match found for "${game.name}". Keeping as placeholder.`);
          game.image = `https://placehold.co/600x900?text=${encodeURIComponent(game.name)}`;
        }
        
        // Respect rate limit
        await delay(350);
      }
    }
    
    if (updatedCount > 0) {
      console.log(`Saving ${updatedCount} updated games back to database...`);
      await pool.query(`
        UPDATE app_state
        SET value = $1, updated_at = NOW()
        WHERE key = 'main'
      `, [JSON.stringify(state)]);
      console.log('Database successfully updated!');
    } else {
      console.log('No updates required.');
    }
    
  } catch (e) {
    console.error('Migration error:', e);
  } finally {
    await pool.end();
    console.log('Connection closed.');
  }
}

run();
