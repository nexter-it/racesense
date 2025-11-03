// server.js
const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const dgram = require('dgram');
const { WebSocketServer } = require('ws');
const http = require('http');
const { monitorEventLoopDelay, performance } = require('perf_hooks');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 5000;
const UDP_PORT = process.env.UDP_PORT || 8888;
const WS_PORT = process.env.WS_PORT || 5001;

/* ==== CORS ==== */
const corsOptions = {
  origin: true,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
};
app.use(cors(corsOptions));
app.options('*', cors(corsOptions));
app.use(express.json());

/* ==== Logger ==== */
app.use((req, _res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
  next();
});

/* ==== Health & Root ==== */
app.get('/health', (_req, res) => {
  res.status(200).json({ ok: true, port: PORT, env: process.env.NODE_ENV || 'development' });
});
app.get('/', (_req, res) => {
  res.json({ message: 'Benvenuto in RACESENSE', version: '3.0.1' });
});

/* ==== Persistenza Piloti ==== */
const DATA_DIR = path.join(__dirname, 'data');
const UPLOAD_DIR = path.join(__dirname, 'uploads');
const PILOTS_DB = path.join(DATA_DIR, 'pilots.json');
const CIRCUITS_DIR = path.join(DATA_DIR, 'circuiti');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });
if (!fs.existsSync(PILOTS_DB)) fs.writeFileSync(PILOTS_DB, JSON.stringify([]), 'utf8');

app.use('/uploads', express.static(UPLOAD_DIR));

const readPilots = () => JSON.parse(fs.readFileSync(PILOTS_DB, 'utf8'));
const writePilots = (arr) => fs.writeFileSync(PILOTS_DB, JSON.stringify(arr, null, 2), 'utf8');

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname || '').toLowerCase();
    const base = path.basename(file.originalname || 'upload', ext).replace(/\s+/g, '_');
    cb(null, `${Date.now()}_${Math.random().toString(36).slice(2, 8)}_${base}${ext}`);
  }
});
const upload = multer({ storage, limits: { fileSize: 5 * 1024 * 1024 } });

/* ==== API Piloti ==== */
app.get('/api/pilots', (_req, res) => res.json(readPilots()));

app.post('/api/pilots', upload.fields([
  { name: 'photoDriver', maxCount: 1 },
  { name: 'photoTeam', maxCount: 1 }
]), (req, res) => {
  try {
    const { name, surname, team } = req.body;
    if (!name || !surname || !team) return res.status(400).json({ error: 'Campi obbligatori: name, surname, team' });

    let championships = [];
    if (req.body.championships) {
      try {
        championships = JSON.parse(req.body.championships);
        if (!Array.isArray(championships)) championships = [];
      } catch {
        championships = Array.isArray(req.body.championships) ? req.body.championships : [req.body.championships];
      }
    }

    const driverFile = req.files?.photoDriver?.[0] || null;
    const teamFile = req.files?.photoTeam?.[0] || null;

    const pilot = {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
      name: String(name).trim(),
      surname: String(surname).trim(),
      team: String(team).trim(),
      championships,
      photoDriverUrl: driverFile ? `/uploads/${driverFile.filename}` : null,
      photoTeamUrl: teamFile ? `/uploads/${teamFile.filename}` : null,
      createdAt: new Date().toISOString()
    };

    const pilots = readPilots();
    pilots.unshift(pilot);
    writePilots(pilots);
    res.status(201).json(pilot);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Errore nel salvataggio pilota' });
  }
});

app.delete('/api/pilots/:id', (req, res) => {
  try {
    const pilots = readPilots();
    const idx = pilots.findIndex(p => p.id === req.params.id);
    if (idx === -1) return res.status(404).json({ error: 'Pilota non trovato' });
    const [removed] = pilots.splice(idx, 1);
    writePilots(pilots);

    const toDel = [removed.photoDriverUrl, removed.photoTeamUrl].filter(Boolean)
      .map(u => path.join(__dirname, u.replace(/^\//, '')));
    toDel.forEach(fp => { if (fp.startsWith(UPLOAD_DIR) && fs.existsSync(fp)) fs.unlink(fp, () => { }); });

    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Errore nella cancellazione' });
  }
});

/* ==== API Circuiti ==== */
function safeReadJSON(fullPath) {
  try { return JSON.parse(fs.readFileSync(fullPath, 'utf8')); }
  catch { return null; }
}

app.get('/api/circuits', (_req, res) => {
  try {
    if (!fs.existsSync(CIRCUITS_DIR)) return res.json([]);
    const files = fs.readdirSync(CIRCUITS_DIR).filter(f => f.toLowerCase().endsWith('.json'));
    const list = files.map(f => {
      const full = path.join(CIRCUITS_DIR, f);
      const j = safeReadJSON(full);
      if (!j) return null;
      return {
        id: j.id || path.basename(f, '.json'),
        name: j.name || path.basename(f, '.json'),
        createdAt: j.createdAt || null,
        points: j.meta?.points || j.pathPoints?.length || 0,
        lengthMeters: j.stats?.lengthMeters || null,
        widthMeters: j.params?.widthMeters ?? null,
        filename: f
      };
    }).filter(Boolean).sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
    res.json(list);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Errore lettura circuiti' });
  }
});

app.get('/api/circuits/:id', (req, res) => {
  try {
    if (!fs.existsSync(CIRCUITS_DIR)) return res.status(404).json({ error: 'Cartella circuiti non trovata' });
    const files = fs.readdirSync(CIRCUITS_DIR).filter(f => f.toLowerCase().endsWith('.json'));

    let file = files.find(f => path.basename(f, '.json') === req.params.id);
    let data = null;
    if (file) {
      data = safeReadJSON(path.join(CIRCUITS_DIR, file));
    } else {
      for (const f of files) {
        const j = safeReadJSON(path.join(CIRCUITS_DIR, f));
        if (j?.id === req.params.id) { data = j; file = f; break; }
      }
    }
    if (!data) return res.status(404).json({ error: 'Circuito non trovato' });
    res.json(data);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Errore lettura circuito' });
  }
});

/* ==== WebSocket server ==== */
const server = http.createServer(app);

// perMessageDeflate + backpressure-ready
const wss = new WebSocketServer({
  port: WS_PORT,
  perMessageDeflate: {
    zlibDeflateOptions: { level: 6 },
    clientNoContextTakeover: true,
    serverNoContextTakeover: true
  }
});
const wsClients = new Set();

// === METRICHE E BROADCAST SICURO ===
const loop = monitorEventLoopDelay({ resolution: 20 });
loop.enable();

const metrics = {
  wsClients: 0,
  gpsPacketsPerSec: 0,
  wsBytesPerSec: 0,
  lastSnapshotBuildMs: 0,
  _acc: { gpsPackets: 0, wsBytes: 0 }
};

wss.on('connection', (ws) => {
  console.log(`[WS] Client connesso. Totale: ${wss.clients.size}`);
  wsClients.add(ws);
  metrics.wsClients = wss.clients.size;

  ws.on('close', () => {
    wsClients.delete(ws);
    console.log(`[WS] Client disconnesso. Totale: ${wss.clients.size}`);
    metrics.wsClients = wss.clients.size;
  });
  ws.on('error', (err) => console.error('[WS] Errore:', err.message));

  if (Race.isActive()) {
    try { ws.send(JSON.stringify(Race.initPayload())); } catch (_) { }
  } else {
    try { ws.send(JSON.stringify({ type: 'race_inactive' })); } catch (_) { }
  }
});

setInterval(() => {
  metrics.gpsPacketsPerSec = metrics._acc.gpsPackets;
  metrics.wsBytesPerSec = metrics._acc.wsBytes;
  metrics._acc.gpsPackets = 0;
  metrics._acc.wsBytes = 0;
}, 1000);

function _broadcastString(str) {
  const sz = Buffer.byteLength(str);
  wsClients.forEach(c => {
    if (c.readyState !== 1) return;
    if (c.bufferedAmount && c.bufferedAmount > 1_000_000) return;
    try { c.send(str); metrics._acc.wsBytes += sz; } catch (_) { }
  });
}
function broadcastJSON(obj) { _broadcastString(JSON.stringify(obj)); }

// throttle 20 Hz degli snapshot
let lastBroadcast = 0;
function tryBroadcastSnapshot() {
  const now = Date.now();
  if (now - lastBroadcast < 50) return;
  lastBroadcast = now;
  const t0 = performance.now();
  const snap = Race.snapshot();
  metrics.lastSnapshotBuildMs = +(performance.now() - t0).toFixed(2);
  _broadcastString(JSON.stringify(snap));
}

/* ==== UDP Listener ==== */
const udpServer = dgram.createSocket('udp4');
udpServer.on('message', (msg) => {
  try {
    metrics._acc.gpsPackets++;

    // Formato: MAC/LAT/LON/SATS/QUAL/SPEED_KMH/YYMMDDhhmmss[/CPUTEMP]
    const parts = msg.toString('utf8').trim().split('/');
    if (parts.length < 7) return;
    const [mac, latStr, lonStr, satsStr, qualStr, speedStr, ts, cpuTempStr] = parts;

    const gps = {
      mac: String(mac || '').toUpperCase(),
      lat: parseFloat(latStr),
      lon: parseFloat(lonStr),
      sats: parseInt(satsStr) || 0,
      qual: parseInt(qualStr) || 0,
      speedKmh: parseFloat(speedStr) || 0,
      ts: ts || null,
      cpuTemp: cpuTempStr ? parseFloat(cpuTempStr) : null,
      receivedAt: Date.now()
    };

    if (Race.isActive()) {
      Race.applyGPS(gps);
      tryBroadcastSnapshot(); // 20Hz
    } else {
      broadcastJSON({ type: 'gps_raw', data: gps });
    }
  } catch (e) {
    console.error('[UDP] Errore parsing:', e.message);
  }
});
udpServer.on('listening', () => {
  const addr = udpServer.address();
  console.log(`[UDP] Listening on ${addr.address}:${addr.port} for GPS packets`);
});
udpServer.on('error', (err) => {
  console.error('[UDP] Errore:', err);
  udpServer.close();
});
udpServer.bind(UDP_PORT);

/* ==== RACE ENGINE (in-memory) ==== */
const Race = (() => {
  let active = false;
  let config = null; // { circuitId, circuitData, totalLaps, assignments, pilots }
  let raceStatus = 'IN CORSO';
  const drivers = new Map(); // mac -> driver state

  // Helpers
  const toRad = d => d * Math.PI / 180;
  function haversine(lat1, lon1, lat2, lon2) {
    const R = 6371000;
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }
  function closestSector(lat, lon, sectors) {
    let min = Infinity, idx = 0;
    for (let i = 0; i < sectors.length; i++) {
      const s = sectors[i];
      const d = haversine(lat, lon, s.lat, s.lon);
      if (d < min) { min = d; idx = i; }
    }
    return idx;
  }
  function pilotById(id) {
    return (config?.pilots || []).find(p => String(p.id) === String(id));
  }

  function computeLeaderboard() {
    const arr = Array.from(drivers.values());
    arr.sort((a, b) => {
      if (a.lapCount !== b.lapCount) return b.lapCount - a.lapCount;
      return b.sectorIdx - a.sectorIdx;
    });
    arr.forEach((d, i) => d.position = i + 1);
    return arr;
  }
  function computeGaps(sorted) {
    if (!sorted.length) return;
    const leader = sorted[0];
    sorted.forEach(d => {
      if (d.mac === leader.mac) { d.gapToLeader = 'LEADER'; return; }
      if (d.lapCount < leader.lapCount) d.gapToLeader = `+${leader.lapCount - d.lapCount}L`;
      else {
        const sectorDiff = leader.sectorIdx - d.sectorIdx;
        const est = Math.max(0, sectorDiff / 10);
        d.gapToLeader = `+${est.toFixed(2)}`;
      }
    });
  }
  function globalBestLap() {
    let best = null;
    drivers.forEach(d => {
      if (d.bestLapTime && (best === null || d.bestLapTime < best)) best = d.bestLapTime;
    });
    return best;
  }
  function penaltySummary(p) {
    const parts = [];
    if (p.timeSec) parts.push(`+${p.timeSec}s`);
    if (p.warnings) parts.push(`⚠️ x${p.warnings}`);
    if (p.dq) parts.push('DQ');
    return parts.join('  ') || '—';
  }
  function nextG(prev = { lat: 0, long: 0, vert: 0 }) {
    const jitter = (x, s, min, max) => Math.max(min, Math.min(max, x + (Math.random() - 0.5) * s));
    const lat = jitter(prev.lat, 0.2, -2.8, 2.8);
    const lon = jitter(prev.long, 0.2, -2.8, 2.8);
    const vert = jitter(prev.vert, 0.08, -0.9, 0.9);
    const total = Math.sqrt(lat * lat + lon * lon + vert * vert);
    return { lat: +lat.toFixed(2), long: +lon.toFixed(2), vert: +vert.toFixed(2), total: +total.toFixed(2) };
  }

  // arrotondamenti per ridurre JSON
  const round6 = (x) => Math.round((x + Number.EPSILON) * 1e6) / 1e6;
  const round1 = (x) => Math.round((x + Number.EPSILON) * 10) / 10;

  // payload iniziale (una tantum) con sectors
  function makeInitPayload() {
    if (!active || !config?.circuitData) return { type: 'race_inactive' };
    return {
      type: 'race_init',
      ts: new Date().toISOString(),
      totalLaps: config.totalLaps,
      raceStatus,
      circuit: {
        id: config.circuitId,
        name: config.circuitData?.name || config.circuitId,
        stats: config.circuitData?.stats || {},
        params: config.circuitData?.params || {},
        sectors: config.circuitData?.sectors || []
      }
    };
  }

  return {
    isActive: () => active,
    start: (payload) => {
      if (!payload?.circuitId || !payload?.assignments || !payload?.pilots) {
        throw new Error('Config gara incompleta');
      }
      // carica circuitData completo (con sectors)
      const files = fs.readdirSync(CIRCUITS_DIR).filter(f => f.toLowerCase().endsWith('.json'));
      let circuitData = null;
      for (const f of files) {
        const full = path.join(CIRCUITS_DIR, f);
        const j = safeReadJSON(full);
        if (!j) continue;
        const id = j.id || path.basename(f, '.json');
        if (id === payload.circuitId) { circuitData = j; break; }
      }
      if (!circuitData?.sectors?.length) throw new Error('Circuito non trovato o privo di sectors');

      active = true;
      raceStatus = 'IN CORSO';
      drivers.clear();
      config = {
        circuitId: payload.circuitId,
        circuitData,
        totalLaps: Number(payload.totalLaps || 10),
        assignments: payload.assignments,
        pilots: payload.pilots
      };
      console.log('[RACE] Avviata su:', circuitData.name || config.circuitId);
    },
    stop: () => {
      active = false;
      config = null;
      drivers.clear();
      raceStatus = 'FINITA';
      console.log('[RACE] Terminata');
    },
    applyGPS: (gps) => {
      if (!active || !config?.circuitData?.sectors) return;
      const { mac, lat, lon, speedKmh } = gps;
      const pilotId = config.assignments?.[mac];
      if (!pilotId) return;

      const sectors = config.circuitData.sectors;
      const sectorIdx = closestSector(lat, lon, sectors);
      const totalSectors = sectors.length;
      const pilot = (config?.pilots || []).find(p => String(p.id) === String(pilotId));
      if (!pilot) return;

      const existing = drivers.get(mac) || {
        mac,
        pilotId,
        fullName: `${pilot.name || ''} ${pilot.surname || ''}`.trim(),
        tag: String((pilot.surname || '').toUpperCase()).slice(0, 4) || 'PIL',
        team: pilot.team,
        photoTeamUrl: pilot.photoTeamUrl || null,
        lat, lon, speed: 0,
        sectorIdx,
        lastSectorIdx: sectorIdx,
        lapCount: 0,
        lapStartTime: Date.now(),
        lastLapTime: null,
        bestLapTime: null,
        lapTimes: [],
        pit: false,
        out: false,
        penalties: { timeSec: 0, warnings: 0, dq: false, entries: [] },
        gforce: { lat: 0, long: 0, vert: 0, total: 0 },
        updatedAt: Date.now()
      };

      let { lapCount, lastLapTime, bestLapTime, lapStartTime, lapTimes } = existing;

      // crossing linea start
      if (existing.lastSectorIdx > totalSectors - 10 && sectorIdx < 10) {
        const lapSec = (Date.now() - existing.lapStartTime) / 1000;
        if (lapSec > 5) {
          lapCount += 1;
          lastLapTime = lapSec;
          bestLapTime = (!bestLapTime || lapSec < bestLapTime) ? lapSec : bestLapTime;
          lapStartTime = Date.now();
          lapTimes = [...lapTimes, +lapSec.toFixed(3)];
        }
      }

      const updated = {
        ...existing,
        lat, lon,
        speed: speedKmh || 0,
        sectorIdx,
        lastSectorIdx: sectorIdx,
        lapCount, lastLapTime, bestLapTime, lapStartTime, lapTimes,
        gforce: nextG(existing.gforce),
        updatedAt: Date.now()
      };
      drivers.set(mac, updated);
    },
    setStatus: (status) => {
      const allowed = ['IN CORSO', 'FINITA', 'RED FLAG', 'YELLOW FLAG'];
      if (!allowed.includes(status)) throw new Error('Stato non valido');
      raceStatus = status;
    },
    applyPenalty: ({ mac, type }) => {
      const d = drivers.get(mac);
      if (!d) throw new Error('Pilota non trovato');
      const p = d.penalties || { timeSec: 0, warnings: 0, dq: false, entries: [] };

      if (type === '+5s' || type === '+10s' || type === '+15s') {
        const add = parseInt(type.replace(/\D/g, ''), 10);
        p.timeSec += add; p.entries.push({ type, value: add, ts: Date.now() });
      } else if (type === '1mo avv. squalifica') {
        p.warnings += 1; p.entries.push({ type, value: 'WARN', ts: Date.now() });
      } else if (type === 'squalifica') {
        p.dq = true; p.entries.push({ type, value: 'DQ', ts: Date.now() });
      } else {
        throw new Error('Tipo penalità non valido');
      }
      d.penalties = p;
      drivers.set(mac, d);
    },
    snapshot: () => {
      if (!active) return { type: 'race_inactive' };
      const sorted = computeLeaderboard();
      computeGaps(sorted);
      const best = globalBestLap();
      return {
        type: 'race_snapshot',
        ts: new Date().toISOString(),
        totalLaps: config.totalLaps,
        raceStatus,
        leaderMac: sorted[0]?.mac || null,
        globalBestLap: best,
        circuit: {
          id: config.circuitId,
          name: config.circuitData?.name || config.circuitId,
          stats: config.circuitData?.stats || {},
          params: config.circuitData?.params || {}
        },
        drivers: sorted.map(d => ({
          mac: d.mac,
          pilotId: d.pilotId,
          fullName: d.fullName,
          tag: d.tag,
          team: d.team,
          photoTeamUrl: d.photoTeamUrl,
          lat: round6(d.lat),
          lon: round6(d.lon),
          speedKmh: round1(d.speed),
          sectorIdx: d.sectorIdx,
          lapCount: d.lapCount,
          lastLapTime: d.lastLapTime,
          bestLapTime: d.bestLapTime,
          lapTimes: Array.isArray(d.lapTimes) ? d.lapTimes.slice(-50) : [], // ⬅️ includo ultimi 50
          position: d.position,
          gapToLeader: d.gapToLeader,
          penalty: {
            timeSec: d.penalties?.timeSec || 0,
            warnings: d.penalties?.warnings || 0,
            dq: !!d.penalties?.dq,
            summary: penaltySummary(d.penalties || {})
          },
          gforce: d.gforce
        }))
      };
    },
    getPilot: (mac) => {
      if (!active) return null;
      const d = drivers.get(String(mac).toUpperCase());
      if (!d) return null;
      return {
        mac: d.mac,
        pilotId: d.pilotId,
        fullName: d.fullName,
        tag: d.tag,
        team: d.team,
        photoTeamUrl: d.photoTeamUrl,
        lat: d.lat, lon: d.lon,
        speedKmh: d.speed,
        sectorIdx: d.sectorIdx,
        lapCount: d.lapCount,
        lastLapTime: d.lastLapTime,
        bestLapTime: d.bestLapTime,
        lapTimes: d.lapTimes, // completo via API singolo pilota
        position: d.position || null,
        penalty: {
          timeSec: d.penalties?.timeSec || 0,
          warnings: d.penalties?.warnings || 0,
          dq: !!d.penalties?.dq,
          summary: penaltySummary(d.penalties || {})
        },
        gforce: d.gforce
      };
    },
    initPayload: () => makeInitPayload()
  };
})();

/* ==== API Gara ==== */
app.post('/api/race/start', (req, res) => {
  try {
    if (Race.isActive()) {
      return res.status(409).json({ error: 'Gara già in corso', snapshot: Race.snapshot() });
    }
    Race.start({
      circuitId: String(req.body.circuitId),
      totalLaps: Number(req.body.totalLaps || 10),
      assignments: req.body.assignments || {},
      pilots: req.body.pilots || []
    });

    broadcastJSON(Race.initPayload()); // sectors una volta
    const t0 = performance.now();
    const snap = Race.snapshot();
    broadcastJSON(snap);
    res.json({ ok: true, snapshot: snap, lastSnapshotBuildMs: +(performance.now() - t0).toFixed(2) });
  } catch (e) {
    console.error('[RACE] start error', e.message);
    res.status(400).json({ error: e.message });
  }
});
app.post('/api/race/stop', (_req, res) => {
  Race.stop();
  broadcastJSON({ type: 'race_inactive' });
  res.json({ ok: true });
});
app.get('/api/race/state', (_req, res) => {
  res.json(Race.snapshot());
});

/* ==== API Comandi Gara ==== */
app.post('/api/race/status', (req, res) => {
  try {
    Race.setStatus(String(req.body.status));
    const t0 = performance.now();
    const snap = Race.snapshot();
    broadcastJSON(snap);
    res.json({ ok: true, lastSnapshotBuildMs: +(performance.now() - t0).toFixed(2) });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});
app.post('/api/race/penalty', (req, res) => {
  try {
    const { mac, type } = req.body || {};
    Race.applyPenalty({ mac, type });
    const t0 = performance.now();
    const snap = Race.snapshot();
    broadcastJSON(snap);
    res.json({ ok: true, lastSnapshotBuildMs: +(performance.now() - t0).toFixed(2) });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

/* ==== API Singolo Pilota ==== */
app.get('/api/race/pilot/:mac', (req, res) => {
  const mac = String(req.params.mac || '').toUpperCase();
  const d = Race.getPilot(mac);
  if (!d) return res.status(404).json({ error: 'Pilota non trovato o gara non attiva' });
  const snap = Race.snapshot();
  res.json({
    ok: true,
    pilot: d,
    circuit: snap.circuit || null,
    raceStatus: snap.raceStatus || 'IN CORSO',
    totalLaps: snap.totalLaps || 0
  });
});

/* ==== API Metriche ==== */
app.get('/api/metrics', (_req, res) => {
  res.json({
    ok: true,
    node: process.version,
    rssMB: Math.round(process.memoryUsage().rss / 1024 / 1024),
    eventLoopLagMs: +(loop.mean / 1e6).toFixed(2),
    wsClients: metrics.wsClients,
    gpsPacketsPerSec: metrics.gpsPacketsPerSec,
    wsBytesPerSec: metrics.wsBytesPerSec,
    lastSnapshotBuildMs: metrics.lastSnapshotBuildMs
  });
});

app.listen(PORT, () => {
  console.log(`RACESENSE server running on port ${PORT}`);
  console.log(`Health: http://localhost:${PORT}/health`);
  console.log(`WebSocket server on port ${WS_PORT}`);
  console.log(`UDP GPS listener on port ${UDP_PORT}`);
});
