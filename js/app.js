"use strict";

const unitSettings = {
  kt: { factor: 1, label: "knots" },
  kmh: { factor: 1.852, label: "km/h" },
  ms: { factor: 0.514444, label: "m/s" }
};

const modelSelect = document.getElementById('modelSelect');
if (modelSelect) {
  modelSelect.addEventListener('change', (e) => {
    currentModel = e.target.value;
    if (typeof loadWindParticleOverlay === 'function') {
      loadWindParticleOverlay(currentModel);
    }
    if (selectedSpot) {
      openSpotDetail(selectedSpot.lat, selectedSpot.lon);
    }
  });
}

let activeUnit = "kt";
let selectedStation = null;
let selectedSpot = null;

const MODEL_LABELS = {
  icon_eu: "ICON-EU",
  meteofrance_arome_france_hd: "AROME France HD"
};

function preferredSpotModel() {
  const m = (typeof currentModel === 'string') ? currentModel : 'icon_eu';
  return (m === 'meteofrance_arome_france_hd' || m === 'icon_eu') ? m : 'icon_eu';
}

function pickNearestEntry(series, when) {
  if (!Array.isArray(series) || series.length === 0) return null;
  const t = when.getTime();
  
  const validSeries = series.filter(entry => entry && entry.time instanceof Date && entry.speed !== null);
  if (validSeries.length === 0) return null;

  return validSeries.reduce((prev, curr) => {
    return Math.abs(curr.time.getTime() - t) < Math.abs(prev.time.getTime() - t) ? curr : prev;
  });
}

async function fetchCurrentWind(lat, lon, model) {
  try {
    const params = new URLSearchParams({
      latitude: String(lat),
      longitude: String(lon),
      current: "wind_speed_10m",
      models: model,
      wind_speed_unit: "kn",
      timeformat: "unixtime",
      timezone: "GMT"
    });
    const res = await fetch("https://api.open-meteo.com/v1/forecast?" + params);
    if (!res.ok) return null;
    const json = await res.json();
    if (!json.current) return null;
    const speed = parseNumeric(json.current.wind_speed_10m);
    if (speed === null) return null;
    const time = Number.isFinite(json.current.time) ? new Date(json.current.time * 1000) : null;
    return { speed, time };
  } catch (_) {
    return null;
  }
}

function formatUtcStamp(date) {
  if (!(date instanceof Date) || isNaN(date)) return null;
  return date.toISOString().slice(11, 16) + " UTC";
}

function getUnit() { 
  return unitSettings[activeUnit]; 
}

function parseNumeric(val) {
  if (val === null || val === undefined || val === "M" || val === "" || val === "N/A") return null;
  const n = Number(val);
  return Number.isFinite(n) ? n : null;
}

function formatSpeed(val) {
  const num = parseNumeric(val);
  if (num === null) return "—";
  return (num * getUnit().factor).toFixed(1);
}

async function openStationDetail(stationProps, obsProps, lat, lon) {
  const props = obsProps || stationProps;
  selectedStation = { props, stationProps, lat, lon };
  selectedSpot = null;
  
  const sid = stationProps.sid || stationProps.id || props.station;
  const sname = stationProps.sname || stationProps.name || sid;

  document.getElementById('stationTitle').textContent = `${sname} (${sid})`;
  document.getElementById('drawer').classList.add('open');

  const speedRaw = props.sknt ?? props.wind_speed_kt ?? props.sknt_kts;
  const drctRaw = props.drct ?? props.wind_dir;

  const speed = parseNumeric(speedRaw);
  const drct = parseNumeric(drctRaw);

  document.getElementById('latestSpeed').textContent = `${formatSpeed(speed)} ${getUnit().label}`;
  document.getElementById('latestMeta').textContent = `Direction: ${drct !== null ? drct + '°' : 'N/A'}`;
  
  const needle = document.getElementById('compassNeedle');
  if (drct !== null) {
    needle.style.transform = `rotate(${(drct + 180) % 360}deg)`;
    needle.style.display = 'block';
  } else {
    needle.style.display = 'none';
  }

  const [history, forecasts] = await Promise.all([
    fetchStationHistory(sid),
    fetchForecasts(lat, lon)
  ]);

  renderChart(history, forecasts, getUnit());
}

async function fetchStationHistory(stationId) {
  try {
    const url = `https://mesonet.agron.iastate.edu/cgi-bin/request/asos.py?station=${stationId}&data=sknt&data=gust&hours=36&format=onlycomma&tz=UTC`;
    const res = await fetch(url);
    const text = await res.text();
    const lines = text.trim().split(/\r?\n/).filter(l => !l.startsWith('#'));
    if (lines.length < 2) return [];

    const headers = lines[0].split(',');
    const idxValid = headers.indexOf('valid');
    const idxSknt = headers.indexOf('sknt');

    return lines.slice(1).map(line => {
      const parts = line.split(',');
      const time = new Date(parts[idxValid].replace(' ', 'T') + 'Z');
      const speed = parseNumeric(parts[idxSknt]);
      return { time, speed };
    }).filter(p => p.time && p.speed !== null);
  } catch (_) {
    return [];
  }
}

async function fetchForecasts(lat, lon) {
  try {
    const params = new URLSearchParams({
      latitude: String(lat),
      longitude: String(lon),
      hourly: "wind_speed_10m",
      models: "meteofrance_arome_france_hd,icon_eu",
      wind_speed_unit: "kn",
      timeformat: "unixtime",
      timezone: "GMT"
    });

    const res = await fetch("https://api.open-meteo.com/v1/forecast?" + params);
    const json = await res.json();
    
    const times = json.hourly.time;
    const aromeSpeeds = json.hourly.wind_speed_10m_meteofrance_arome_france_hd || [];
    const iconSpeeds = json.hourly.wind_speed_10m_icon_eu || [];

    return {
      arome: times.map((t, i) => ({ time: new Date(t * 1000), speed: parseNumeric(aromeSpeeds[i]) })),
      icon: times.map((t, i) => ({ time: new Date(t * 1000), speed: parseNumeric(iconSpeeds[i]) }))
    };
  } catch (_) {
    return { arome: [], icon: [] };
  }
}

async function openSpotDetail(lat, lon) {
  const formattedLat = lat.toFixed(3);
  const formattedLon = lon.toFixed(3);

  selectedSpot = { lat, lon };
  selectedStation = null;

  document.getElementById('stationTitle').textContent = `Spot (${formattedLat}°, ${formattedLon}°)`;
  document.getElementById('drawer').classList.add('open');

  document.getElementById('latestSpeed').textContent = `Loading...`;
  document.getElementById('latestMeta').textContent = `Coordinates: ${formattedLat}, ${formattedLon}`;
  document.getElementById('compassNeedle').style.display = 'none';

  const model = preferredSpotModel();
  const modelLabel = MODEL_LABELS[model] || model;

  const [forecasts, currentWind] = await Promise.all([
    fetchForecasts(lat, lon),
    fetchCurrentWind(lat, lon, model)
  ]);

  if (!selectedSpot || selectedSpot.lat !== lat || selectedSpot.lon !== lon) return;

  let speedKnots = null;
  let stamp = null;
  let sourceLabel = modelLabel;

  if (currentWind) {
    speedKnots = currentWind.speed;
    stamp = currentWind.time;
  }

  if (speedKnots === null) {
    let series = (model === 'meteofrance_arome_france_hd') ? forecasts.arome : forecasts.icon;
    if (!series.length) series = series === forecasts.arome ? forecasts.icon : forecasts.arome;
    sourceLabel = (series === forecasts.arome) ? (MODEL_LABELS.meteofrance_arome_france_hd || 'AROME') : (MODEL_LABELS.icon_eu || 'ICON-EU');
    const nearest = pickNearestEntry(series, new Date());
    if (nearest) {
      speedKnots = nearest.speed;
      stamp = nearest.time;
    }
  }

  if (speedKnots !== null) {
    document.getElementById('latestSpeed').textContent = `${formatSpeed(speedKnots)} ${getUnit().label}`;
    const stampText = formatUtcStamp(stamp);
    document.getElementById('latestMeta').textContent =
      `Coordinates: ${formattedLat}, ${formattedLon} · ${sourceLabel}${stampText ? ' · ' + stampText : ''}`;
  } else {
    document.getElementById('latestSpeed').textContent = "—";
    document.getElementById('latestMeta').textContent =
      `Coordinates: ${formattedLat}, ${formattedLon} · No forecast for ${sourceLabel}`;
  }

  renderChart([], forecasts, getUnit());
}

document.getElementById('closeDrawer').addEventListener('click', () => {
  document.getElementById('drawer').classList.remove('open');
  selectedStation = null;
  selectedSpot = null;
});

document.getElementById('units').addEventListener('change', (e) => {
  activeUnit = e.target.value;
  if (typeof updateVelocityOverlayUnit === 'function') updateVelocityOverlayUnit();
  if (typeof loadLiveMapData === 'function') loadLiveMapData();
  
  if (selectedStation) {
    openStationDetail(selectedStation.stationProps, selectedStation.props, selectedStation.lat, selectedStation.lon);
  } else if (selectedSpot) {
    openSpotDetail(selectedSpot.lat, selectedSpot.lon);
  }
});

document.getElementById('refreshMap').addEventListener('click', () => {
  if (typeof loadLiveMapData === 'function') loadLiveMapData();
});

// In app.js - Update the units event listener
document.getElementById('units').addEventListener('change', (e) => {
  activeUnit = e.target.value;
  if (typeof updateVelocityOverlayUnit === 'function') updateVelocityOverlayUnit();
  if (typeof loadLiveMapData === 'function') loadLiveMapData();
  if (typeof updateLegend === 'function') updateLegend(); // Added line
  
  // ... rest of the listener ...
});

window.addEventListener('DOMContentLoaded', () => {
  if (typeof initMap === 'function') {
    initMap();
  }
  
  // Prevent map clicks and scrolls from bleeding through the drawer overlay
  const drawer = document.getElementById('drawer');
  if (drawer && typeof L !== 'undefined') {
    L.DomEvent.disableClickPropagation(drawer);
    L.DomEvent.disableScrollPropagation(drawer);
  }
});