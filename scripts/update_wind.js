const fs = require('fs');
const path = require('path');

const stepDeg = 0.4;
const maxLat = 52.0, minLat = 41.0;
const minLon = -6.0, maxLon = 10.0;

const sleep = ms => new Promise(r => setTimeout(r, ms));

function log(msg) {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

async function fetchGrid(modelName) {
  const lats = [], lons = [];
  for (let lat = maxLat; lat >= minLat; lat -= stepDeg) lats.push(Number(lat.toFixed(2)));
  for (let lon = minLon; lon <= maxLon; lon += stepDeg) lons.push(Number(lon.toFixed(2)));

  const gridLats = [], gridLons = [];
  for (let i = 0; i < lats.length; i++) {
    for (let j = 0; j < lons.length; j++) {
      gridLats.push(lats[i]);
      gridLons.push(lons[j]);
    }
  }

  const jsonList = [];
  // Maximize the batch size to the Open-Meteo limit of 100
  const batchSize = 100; 
  const totalChunks = Math.ceil(gridLats.length / batchSize);

  for (let i = 0; i < gridLats.length; i += batchSize) {
    const chunkNum = Math.floor(i / batchSize) + 1;
    const latChunk = gridLats.slice(i, i + batchSize);
    const lonChunk = gridLons.slice(i, i + batchSize);
    
    const params = new URLSearchParams({
      latitude: latChunk.join(','),
      longitude: lonChunk.join(','),
      current: "wind_speed_10m,wind_direction_10m",
      models: modelName
    });

    let success = false;
    let retries = 0;
    const maxRetries = 8;
    
    while (retries < maxRetries && !success) {
      try {
        const res = await fetch("https://api.open-meteo.com/v1/forecast?" + params);
        
        if (res.status === 429) {
          retries++;
          const waitTime = retries * 8000; 
          log(`[WARNING] Rate Limited (429) on chunk ${chunkNum}/${totalChunks}. Waiting ${waitTime / 1000}s...`);
          await sleep(waitTime);
          continue;
        }
        
        if (!res.ok) throw new Error(`API returned HTTP status ${res.status}`);
        
        const data = await res.json();
        Array.isArray(data) ? jsonList.push(...data) : jsonList.push(data);
        success = true;
        log(`[SUCCESS] Fetched chunk ${chunkNum}/${totalChunks} (${latChunk.length} points)`);
      } catch (err) {
        retries++;
        if (retries >= maxRetries) {
          throw new Error(`Failed chunk ${chunkNum}/${totalChunks} after ${maxRetries} retries: ${err.message}`);
        }
        const waitTime = retries * 6000;
        log(`[WARNING] Network error on chunk ${chunkNum}/${totalChunks} (${err.message}). Retrying in ${waitTime / 1000}s...`);
        await sleep(waitTime);
      }
    }
    
    // Throttling for shared IPs
    if (chunkNum % 5 === 0) {
      log(`[THROTTLE] Pausing for 10s to prevent burst rate limiting...`);
      await sleep(10000);
    } else {
      await sleep(3000); 
    }
  }
  
  return jsonList;
}

async function main() {
  const dataDir = path.join(__dirname, '../data');
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

  const formatPayload = (dataArray) => {
    const firstValid = dataArray.find(item => item && item.current && item.current.time);
    return {
      fetch_time: new Date().toISOString(),
      data_time: firstValid ? firstValid.current.time : new Date().toISOString(),
      data: dataArray
    };
  };

  log("Starting data update process...");

  log("--- Fetching ICON-EU ---");
  const iconData = await fetchGrid("icon_eu");
  fs.writeFileSync(path.join(dataDir, 'wind_icon_eu.json'), JSON.stringify(formatPayload(iconData)));
  log("Saved wind_icon_eu.json");

  // Pause between models to let the shared IP cool down
  await sleep(5000);

  log("--- Fetching AROME ---");
  const aromeData = await fetchGrid("meteofrance_arome_france_hd");
  fs.writeFileSync(path.join(dataDir, 'wind_arome.json'), JSON.stringify(formatPayload(aromeData)));
  log("Saved wind_arome.json");

  log("Data successfully updated! You can now view the map.");
}

main().catch(err => {
  console.error(`[${new Date().toISOString()}] [ERROR] ${err.message}`);
  process.exit(1);
});
