"use strict";

let map, markersLayer, velocityLayer, heatmapLayer;
let currentModel = "icon_eu";
let mapMoveTimeout = null;
let legendControl = null;


function safeParseNumeric(val) {
  if (val === null || val === undefined || val === "M" || val === "" || val === "N/A") return null;
  const n = Number(val);
  return Number.isFinite(n) ? n : null;
}

function safeFormatSpeed(val) {
  const num = safeParseNumeric(val);
  if (num === null) return "—";
  const factor = (typeof getUnit === 'function') ? getUnit().factor : 1;
  return (num * factor).toFixed(1);
}

function safeGetUnitLabel() {
  return (typeof getUnit === 'function') ? getUnit().label : "knots";
}

// Add this new function to map.js to build the dynamic legend
function updateLegend() {
  if (legendControl) map.removeControl(legendControl);
  
  legendControl = L.control({ position: 'bottomright' });
  legendControl.onAdd = function () {
    const div = L.DomUtil.create('div', 'wind-legend');
    const u = getUnit();
    
    // Map key knots to the current selected unit
    const val0 = (0).toFixed(0);
    const val16 = (16 * u.factor).toFixed(0);
    const val36 = (36 * u.factor).toFixed(0);
    const val48 = (48 * u.factor).toFixed(0);

    div.innerHTML = `
      <div style="font-size: 11px; font-weight: bold; margin-bottom: 5px; color: #edf3ff;">
        Wind (${u.label})
      </div>
      <div style="height: 10px; width: 200px; border-radius: 4px; background: linear-gradient(to right, 
        rgba(255,255,255,0.8) 0%, 
        rgba(180,240,255,0.9) 12%, 
        rgba(72,202,228,0.9) 23%, 
        rgba(34,197,94,0.9) 33%, 
        rgba(234,179,8,0.9) 45%, 
        rgba(249,115,22,0.9) 58%, 
        rgba(239,68,68,0.9) 75%, 
        rgba(217,70,239,0.9) 100%); border: 1px solid #354258;">
      </div>
      <div style="display: flex; justify-content: space-between; font-size: 10px; color: #a4b3ca; margin-top: 4px;">
        <span>${val0}</span>
        <span style="margin-left: -10px;">${val16}</span>
        <span style="margin-left: 10px;">${val36}</span>
        <span>${val48}+</span>
      </div>
    `;
    return div;
  };
  legendControl.addTo(map);
}loadWindParticleOverlay

// --------------------------------------------------------------------------
// Continuous Windguru Color Scale
// --------------------------------------------------------------------------
function getWindRGB(speedKt) {
  if (speedKt === null || isNaN(speedKt) || speedKt < 1) return [255, 255, 255, 0];

  const stops = [
    { kt: 2,  r: 255, g: 255, b: 255, a: 0.00 },
    { kt: 6,  r: 180, g: 240, b: 255, a: 0.18 },
    { kt: 11, r: 72,  g: 202, b: 228, a: 0.25 },
    { kt: 16, r: 34,  g: 197, b: 94,  a: 0.32 },
    { kt: 22, r: 234, g: 179, b: 8,   a: 0.38 },
    { kt: 28, r: 249, g: 115, b: 22,  a: 0.42 },
    { kt: 36, r: 239, g: 68,  b: 68,  a: 0.45 },
    { kt: 48, r: 217, g: 70,  b: 239, a: 0.48 } 
  ];

  if (speedKt <= stops[0].kt) return [stops[0].r, stops[0].g, stops[0].b, stops[0].a];
  if (speedKt >= stops[stops.length - 1].kt) {
    const last = stops[stops.length - 1];
    return [last.r, last.g, last.b, last.a];
  }

  let i = 0;
  while (i < stops.length - 1 && stops[i + 1].kt < speedKt) i++;

  const lower = stops[i];
  const upper = stops[i + 1];
  const t = (speedKt - lower.kt) / (upper.kt - lower.kt);

  const r = Math.round(lower.r + t * (upper.r - lower.r));
  const g = Math.round(lower.g + t * (upper.g - lower.g));
  const b = Math.round(lower.b + t * (upper.b - lower.b));
  const a = lower.a + t * (upper.a - lower.a);

  return [r, g, b, a];
}

function getWindStyle(speedKt) {
  const rgb = getWindRGB(speedKt);
  const color = `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`;
  if (speedKt === null || isNaN(speedKt)) {
    return { color: '#9ca3af', isSpinning: false, duration: '0s' };
  }

  const isSpinning = speedKt >= 12;
  const durationSec = isSpinning ? Math.max(0.4, 3.2 - (speedKt / 12)).toFixed(2) : 0;

  return { color, isSpinning, duration: `${durationSec}s` };
}

function createPinwheelSVG(styleConfig) {
  const spinClass = styleConfig.isSpinning ? 'spinning' : '';
  const durationStyle = styleConfig.isSpinning ? `--spin-speed: ${styleConfig.duration};` : '';

  return `
    <svg class="pinwheel-svg ${spinClass}" style="${durationStyle}" width="28" height="28" viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">
      <g fill="${styleConfig.color}" stroke="#101827" stroke-width="3">
        <path d="M50 50 C50 20, 25 10, 15 25 C10 35, 30 50, 50 50 Z" />
        <path d="M50 50 C80 50, 90 25, 75 15 C65 10, 50 30, 50 50 Z" />
        <path d="M50 50 C50 80, 75 90, 85 75 C90 65, 70 50, 50 50 Z" />
        <path d="M50 50 C20 50, 10 75, 25 85 C35 90, 50 70, 50 50 Z" />
      </g>
      <circle cx="50" cy="50" r="6" fill="#ffffff" stroke="#101827" stroke-width="3" />
    </svg>
  `;
}

// --------------------------------------------------------------------------
// API Helpers
// --------------------------------------------------------------------------
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function fetchWithBackoff(url, maxRetries = 4) {
  let retries = 0;
  while (retries < maxRetries) {
    const res = await fetch(url);
    if (res.status === 429) {
      retries++;
      const delay = (Math.pow(2, retries) * 1000) + (Math.random() * 500);
      console.warn(`API Rate limited (429). Retrying chunk in ${Math.round(delay/1000)}s...`);
      await sleep(delay);
      continue;
    }
    if (!res.ok) throw new Error(`Open-Meteo API Error: ${res.status}`);
    return res.json();
  }
  throw new Error("Max retries reached. API strictly rate-limiting.");
}

// --------------------------------------------------------------------------
// Init Map & Click Listener
// --------------------------------------------------------------------------
function initMap() {
  const mapElement = document.getElementById('map');
  if (!mapElement) return;

  map = L.map('map', { zoomControl: false }).setView([46.603354, 1.888334], 6);

  L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}', {
    attribution: 'Tiles &copy; Esri',
    maxZoom: 16,
    zIndex: 1
  }).addTo(map);

  L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Reference/MapServer/tile/{z}/{y}/{x}', {
    attribution: 'Labels &copy; Esri',
    maxZoom: 16,
    pane: 'markerPane',
    zIndex: 500
  }).addTo(map);

  L.control.zoom({ position: 'bottomright' }).addTo(map);
  markersLayer = L.layerGroup().addTo(map);

  map.on('click', (e) => {
    const lat = e.latlng.lat;
    const lon = e.latlng.lng;
    if (typeof openSpotDetail === 'function') {
      openSpotDetail(lat, lon);
    }
  });

  // Re-fetch particle overlay on pan/zoom, debounced to avoid API spam
  map.on('moveend', () => {
    clearTimeout(mapMoveTimeout);
    mapMoveTimeout = setTimeout(() => {
      loadWindParticleOverlay(currentModel);
    }, 500);
  });

  loadLiveMapData();
  loadWindParticleOverlay(currentModel);
	
	updateLegend(); // Add this line
}

// --------------------------------------------------------------------------
// Bilinear Heatmap + Particle Flow
// --------------------------------------------------------------------------
function getLVSpeedUnit() {
  const u = typeof activeUnit !== 'undefined' ? activeUnit : 'kt';
  return u === 'kmh' ? 'k/h' : u === 'ms' ? 'm/s' : 'kt';
}

function updateVelocityOverlayUnit() {
  if (velocityLayer && typeof velocityLayer.setOptions === 'function') {
    velocityLayer.setOptions({ displayOptions: { speedUnit: getLVSpeedUnit() } });
  }
}

async function loadWindParticleOverlay(modelName) {
  if (velocityLayer) {
    map.removeLayer(velocityLayer);
    velocityLayer = null;
  }
  if (heatmapLayer) {
    map.removeLayer(heatmapLayer);
    heatmapLayer = null;
  }

  if (modelName === "none" || !map) return;

  try {
    // 1. Define the exact fixed grid that matches the GitHub Action output
    const stepDeg = 0.25; 
    const lats = [], lons = [];
    for (let lat = 52.0; lat >= 41.0; lat -= stepDeg) lats.push(Number(lat.toFixed(2)));
    for (let lon = -6.0; lon <= 10.0; lon += stepDeg) lons.push(Number(lon.toFixed(2)));

    const ny = lats.length;
    const nx = lons.length;

    // 2. Fetch the static JSON generated by GitHub Actions
    const fileName = modelName === "icon_eu" ? "wind_icon_eu.json" : "wind_arome.json";
    const res = await fetch(`data/${fileName}`);
    if (!res.ok) throw new Error("Local data file not found.");
    
    const jsonList = await res.json();
    if (!jsonList || jsonList.length === 0) return;

    // 3. Process exactly as before
    const uData = new Float32Array(nx * ny);
    const vData = new Float32Array(nx * ny);
    const speedGrid = Array.from({ length: ny }, () => new Float32Array(nx));

    jsonList.forEach((item, idx) => {
      const row = Math.floor(idx / nx);
      const col = idx % nx;

      if (item && item.current) {
        const speedMS = item.current.wind_speed_10m || 0;
        const dirDeg = item.current.wind_direction_10m || 0;
        const rad = (dirDeg * Math.PI) / 180;
        
        uData[idx] = -speedMS * Math.sin(rad);
        vData[idx] = -speedMS * Math.cos(rad);
        speedGrid[row][col] = speedMS * 1.94384; // knots for heatmap
      }
    });

    const SmoothHeatmapLayer = L.Layer.extend({
      onAdd: function(map) {
        this._map = map;
        this._canvas = L.DomUtil.create('canvas', 'leaflet-smooth-heatmap');
        this._canvas.style.position = 'absolute';
        this._canvas.style.pointerEvents = 'none';
        this._canvas.style.zIndex = '200';
        map.getPanes().overlayPane.appendChild(this._canvas);
        map.on('moveend resize', this._draw, this);
        this._draw();
      },
      onRemove: function(map) {
        L.DomUtil.remove(this._canvas);
        map.off('moveend resize', this._draw, this);
      },
      _draw: function() {
        if (!this._map) return;
        const size = this._map.getSize();
        const topLeft = this._map.containerPointToLayerPoint([0, 0]);
        L.DomUtil.setPosition(this._canvas, topLeft);

        const dpr = window.devicePixelRatio || 1;
        this._canvas.width = size.x * dpr;
        this._canvas.height = size.y * dpr;
        this._canvas.style.width = `${size.x}px`;
        this._canvas.style.height = `${size.y}px`;

        const ctx = this._canvas.getContext('2d');
        ctx.scale(dpr, dpr);

        const step = 8;
        const w = Math.ceil(size.x / step);
        const h = Math.ceil(size.y / step);

        const imgData = ctx.createImageData(w, h);
        const data = imgData.data;

        for (let py = 0; py < h; py++) {
          for (let px = 0; px < w; px++) {
            const containerPoint = L.point(px * step, py * step);
            const latLng = this._map.containerPointToLatLng(containerPoint);

            const lat = latLng.lat;
            const lon = latLng.lng;

            if (lat < lats[ny - 1] || lat > lats[0] || lon < lons[0] || lon > lons[nx - 1]) {
              continue;
            }

            const rowF = (lats[0] - lat) / stepDeg;
            const colF = (lon - lons[0]) / stepDeg;

            const r0 = Math.floor(rowF);
            const r1 = Math.min(ny - 1, r0 + 1);
            const c0 = Math.floor(colF);
            const c1 = Math.min(nx - 1, c0 + 1);

            const dr = rowF - r0;
            const dc = colF - c0;

            const v00 = speedGrid[r0][c0];
            const v10 = speedGrid[r1][c0];
            const v01 = speedGrid[r0][c1];
            const v11 = speedGrid[r1][c1];

            const speedKt = (1 - dr) * ((1 - dc) * v00 + dc * v01) + dr * ((1 - dc) * v10 + dc * v11);

            const rgb = getWindRGB(speedKt);
            const idx = (py * w + px) * 4;

            data[idx]     = rgb[0];
            data[idx + 1] = rgb[1];
            data[idx + 2] = rgb[2];
            data[idx + 3] = Math.round(rgb[3] * 255);
          }
        }

        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = w;
        tempCanvas.height = h;
        tempCanvas.getContext('2d').putImageData(imgData, 0, 0);

        ctx.imageSmoothingEnabled = true;
        ctx.drawImage(tempCanvas, 0, 0, size.x, size.y);
      }
    });

    heatmapLayer = new SmoothHeatmapLayer();
    heatmapLayer.addTo(map);

    const velocityData = [
      {
        header: {
          parameterCategory: 2, parameterNumber: 2, parameterUnit: "m.s-1",
          parameterNumberName: "U-component_of_wind",
          nx: nx, ny: ny, basicAngle: 0, subCenter: 0,
          lo1: lons[0], la1: lats[0], lo2: lons[nx - 1], la2: lats[ny - 1],
          dx: stepDeg, dy: stepDeg
        },
        data: uData
      },
      {
        header: {
          parameterCategory: 2, parameterNumber: 3, parameterUnit: "m.s-1",
          parameterNumberName: "V-component_of_wind",
          nx: nx, ny: ny, basicAngle: 0, subCenter: 0,
          lo1: lons[0], la1: lats[0], lo2: lons[nx - 1], la2: lats[ny - 1],
          dx: stepDeg, dy: stepDeg
        },
        data: vData
      }
    ];

    velocityLayer = L.velocityLayer({
      displayValues: true,
      displayOptions: {
        velocityType: `${modelName === 'icon_eu' ? 'ICON-EU' : 'AROME HD'} Wind`,
        position: 'bottomleft',
        emptyString: 'No wind data',
        speedUnit: getLVSpeedUnit()
      },
      data: velocityData,
      maxVelocity: 30,
      velocityScale: 0.005, // Restored library default
      particleAge: 50,
      particleMultiplier: 1 / 220,
      lineWidth: 1.2,
      colorScale: ["rgba(0,0,0,0.30)", "rgba(15,23,42,0.40)", "rgba(15,23,42,0.55)"]
    });

    velocityLayer.addTo(map);

  } catch (err) {
    console.error("Heatmap & particle overlay error:", err);
  }
}

// --------------------------------------------------------------------------
// Live Station Observations (IEM Bulk CSV)
// --------------------------------------------------------------------------
async function loadLiveMapData() {
  try {
    const [geoRes, currentRes] = await Promise.all([
      fetch('https://mesonet.agron.iastate.edu/geojson/network/FR__ASOS.geojson'),
      fetch('https://mesonet.agron.iastate.edu/cgi-bin/request/asos.py?network=FR__ASOS&data=sknt&data=drct&hours=2&format=onlycomma&tz=UTC')
    ]);

    const geojson = geoRes.ok ? await geoRes.json() : { features: [] };
    const currentMap = new Map();

    if (currentRes.ok) {
      const csvText = await currentRes.text();
      const lines = csvText.trim().split(/\r?\n/).filter(l => l.trim() && !l.startsWith('#'));
      const headerIdx = lines.findIndex(l => l.toLowerCase().startsWith('station,valid'));

      if (headerIdx >= 0) {
        const headers = lines[headerIdx].split(',').map(s => s.trim());
        const idxStation = headers.indexOf('station');
        const idxSknt = headers.indexOf('sknt');
        const idxDrct = headers.indexOf('drct');

        for (let i = headerIdx + 1; i < lines.length; i++) {
          const cells = lines[i].split(',').map(s => s.trim());
          const sid = cells[idxStation];
          if (!sid) continue;

          currentMap.set(sid, {
            sknt: cells[idxSknt],
            drct: cells[idxDrct]
          });
        }
      }
    }

    markersLayer.clearLayers();

    geojson.features.forEach(feature => {
      const geoProps = feature.properties || {};
      const coords = feature.geometry ? feature.geometry.coordinates : null;
      if (!coords || coords.length < 2) return;

      const lat = coords[1];
      const lon = coords[0];
      const stationId = geoProps.sid || geoProps.id;

      const obs = currentMap.get(stationId) || {};
      const speedKnots = safeParseNumeric(obs.sknt);
      const drct = safeParseNumeric(obs.drct);

      const styleConfig = getWindStyle(speedKnots);
      const speedDisplay = safeFormatSpeed(speedKnots);
      const unitLabel = safeGetUnitLabel();
      const isStale = speedKnots === null;

      const dirRotation = drct !== null ? `transform: rotate(${(drct + 180) % 360}deg);` : '';

      const icon = L.divIcon({
        className: 'wind-marker',
        html: `
          <div style="${dirRotation}">
            ${createPinwheelSVG(styleConfig)}
          </div>
          <div class="marker-card ${isStale ? 'stale' : ''}">
            ${stationId}: ${speedDisplay} ${unitLabel}
          </div>
        `,
        iconSize: [85, 50],
        iconAnchor: [42, 25]
      });

      const marker = L.marker([lat, lon], { icon });
      marker.on('click', (e) => {
        L.DomEvent.stopPropagation(e);
        if (typeof openStationDetail === 'function') {
          openStationDetail(geoProps, obs, lat, lon);
        }
      });

      markersLayer.addLayer(marker);
    });

  } catch (err) {
    console.error("Map fetch error:", err);
  }
}