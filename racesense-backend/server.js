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
const recorder = require('./raceRecorder');
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
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

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

const CHAMPIONSHIPS_DB = path.join(DATA_DIR, 'championships.json');
if (!fs.existsSync(CHAMPIONSHIPS_DB)) fs.writeFileSync(CHAMPIONSHIPS_DB, JSON.stringify([]), 'utf8');

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

/* === PUT /api/circuits/:id ===
   Salva i settori personalizzati (customSectors)
   ============================================== */
app.put('/api/circuits/:id', (req, res) => {
  try {
    const circuitId = req.params.id;
    const body = req.body;

    if (!body || !Array.isArray(body.customSectors)) {
      return res.status(400).json({ error: 'Campo customSectors mancante o non valido' });
    }

    if (!fs.existsSync(CIRCUITS_DIR)) {
      return res.status(404).json({ error: 'Cartella circuiti non trovata' });
    }

    const files = fs.readdirSync(CIRCUITS_DIR).filter(f => f.toLowerCase().endsWith('.json'));
    let filePath = null;
    let data = null;

    // 🔍 Cerca il file del circuito (per nome file o id interno)
    for (const f of files) {
      const full = path.join(CIRCUITS_DIR, f);
      const j = safeReadJSON(full);
      if (!j) continue;
      const id = j.id || path.basename(f, '.json');
      if (id === circuitId) {
        filePath = full;
        data = j;
        break;
      }
    }

    if (!filePath || !data) {
      return res.status(404).json({ error: 'Circuito non trovato' });
    }

    // ✏️ Aggiorna solo i settori personalizzati
    data.customSectors = body.customSectors;

    // 💾 Salva su disco
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');

    console.log(`[CIRCUIT] Settori aggiornati per circuito ${circuitId}`);

    res.json({ ok: true, id: circuitId, sectors: body.customSectors.length });
  } catch (err) {
    console.error('[CIRCUIT PUT] Errore:', err);
    res.status(500).json({ error: 'Errore salvataggio circuito' });
  }
});

/* ==== API Campionati ==== */
const readChampionships = () => {
  try { return JSON.parse(fs.readFileSync(CHAMPIONSHIPS_DB, 'utf8')); }
  catch { return []; }
};
const writeChampionships = (arr) => {
  fs.writeFileSync(CHAMPIONSHIPS_DB, JSON.stringify(arr, null, 2), 'utf8');
};

// 📍 GET – restituisce tutti i campionati
app.get('/api/championships', (_req, res) => {
  res.json(readChampionships());
});

// 📍 POST – aggiunge un nuovo campionato (con upload opzionale)
app.post('/api/championships', upload.single('photo'), (req, res) => {
  try {
    const { name } = req.body;
    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'Nome campionato obbligatorio' });
    }

    const championships = readChampionships();
    const newChamp = {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      name: name.trim(),
      photo: req.file ? `/uploads/${req.file.filename}` : null,
      createdAt: new Date().toISOString(),
    };

    championships.unshift(newChamp);
    writeChampionships(championships);
    res.json(championships);
  } catch (err) {
    console.error('[CHAMPIONSHIPS] Errore:', err);
    res.status(500).json({ error: 'Errore nel salvataggio campionato' });
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

    // Formato esteso: MAC/±DD.dddddd7/±DDD.dddddd7/ss/q/vv.v/YYMMDDhhmmss/ax/ay/az/gx/gy/gz/mx/my/mz/qi/qj/qk/qr/roll/pitch/yaw
    // Formato base:   MAC/LAT/LON/SATS/QUAL/SPEED_KMH/YYMMDDhhmmss[/CPUTEMP]
    const parts = msg.toString('utf8').trim().split('/');
    if (parts.length < 7) return;

    const gps = {
      mac: String(parts[0] || '').toUpperCase(),
      lat: parseFloat(parts[1]),
      lon: parseFloat(parts[2]),
      sats: parseInt(parts[3]) || 0,
      qual: parseInt(parts[4]) || 0,
      speedKmh: parseFloat(parts[5]) || 0,
      ts: parts[6] || null,
      receivedAt: Date.now()
    };

    // Dati IMU estesi (se presenti) - salvati solo nelle registrazioni
    if (parts.length >= 23) {
      // Accelerometro (m/s²)
      gps.accel = {
        x: parseFloat(parts[7]) || 0,
        y: parseFloat(parts[8]) || 0,
        z: parseFloat(parts[9]) || 0
      };
      // Giroscopio (rad/s)
      gps.gyro = {
        x: parseFloat(parts[10]) || 0,
        y: parseFloat(parts[11]) || 0,
        z: parseFloat(parts[12]) || 0
      };
      // Magnetometro (μT)
      gps.mag = {
        x: parseFloat(parts[13]) || 0,
        y: parseFloat(parts[14]) || 0,
        z: parseFloat(parts[15]) || 0
      };
      // Quaternione (orientamento)
      gps.quat = {
        i: parseFloat(parts[16]) || 0,
        j: parseFloat(parts[17]) || 0,
        k: parseFloat(parts[18]) || 0,
        r: parseFloat(parts[19]) || 0
      };
      // Angoli Eulero (gradi)
      gps.euler = {
        roll: parseFloat(parts[20]) || 0,
        pitch: parseFloat(parts[21]) || 0,
        yaw: parseFloat(parts[22]) || 0
      };
    } else if (parts.length >= 8) {
      // Retrocompatibilità: cpuTemp (vecchio formato)
      gps.cpuTemp = parseFloat(parts[7]) || null;
    }

    if (Race.isActive()) {
      Race.applyGPS(gps);

      // 🔴 Registra il pacchetto COMPLETO (con tutti i dati IMU)
      if (recorder.isRecording(Race.getCurrentRaceId())) {
        recorder.recordPacket(Race.getCurrentRaceId(), gps);
      }

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
  let currentRaceId = null; // ID univoco della gara corrente
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
    getCurrentRaceId: () => currentRaceId,
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

      // Genera ID univoco per questa gara
      currentRaceId = `race_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

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
      console.log('[RACE] ID:', currentRaceId);
    },
    stop: () => {
      active = false;
      const stoppedRaceId = currentRaceId;
      currentRaceId = null;
      config = null;
      drivers.clear();
      raceStatus = 'FINITA';
      console.log('[RACE] Terminata:', stoppedRaceId);
      return stoppedRaceId;
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

      // === Calcolo settori S1, S2, S3 ===
      if (!existing.sectorTimes) {
        existing.sectorTimes = { S1: null, S2: null, S3: null };
        existing.sectorStartTime = Date.now();
      }

      // Imposta confini settori (3 parti uguali del tracciato)
      const sectorSize = Math.floor(totalSectors / 3);
      const boundaries = {
        S1: [0, sectorSize - 1],
        S2: [sectorSize, 2 * sectorSize - 1],
        S3: [2 * sectorSize, totalSectors - 1]
      };

      // verifica cambio settore
      const prevSector = existing.lastSectorZone;
      let currentZone = null;
      if (sectorIdx >= boundaries.S1[0] && sectorIdx <= boundaries.S1[1]) currentZone = 'S1';
      else if (sectorIdx >= boundaries.S2[0] && sectorIdx <= boundaries.S2[1]) currentZone = 'S2';
      else if (sectorIdx >= boundaries.S3[0] && sectorIdx <= boundaries.S3[1]) currentZone = 'S3';

      // se è cambiato settore (ed esiste precedente)
      if (prevSector && currentZone && prevSector !== currentZone) {
        const elapsed = (Date.now() - existing.sectorStartTime) / 1000;
        existing.sectorTimes[prevSector] = +elapsed.toFixed(3);
        existing.sectorStartTime = Date.now();

        // se finisce S3 → reset settori
        if (prevSector === 'S3') {
          existing.lastSectorTimes = { ...existing.sectorTimes };
          existing.sectorTimes = { S1: null, S2: null, S3: null };
        }
      }
      existing.lastSectorZone = currentZone;

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
          lapTimes: Array.isArray(d.lapTimes) ? d.lapTimes.slice(-50) : [],
          position: d.position,
          gapToLeader: d.gapToLeader,
          penalty: {
            timeSec: d.penalties?.timeSec || 0,
            warnings: d.penalties?.warnings || 0,
            dq: !!d.penalties?.dq,
            summary: penaltySummary(d.penalties || {})
          },
          gforce: d.gforce,
          sectorTimes: d.sectorTimes || { S1: null, S2: null, S3: null },
          lastSectorTimes: d.lastSectorTimes || { S1: null, S2: null, S3: null }
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
        gforce: d.gforce,
        sectorTimes: d.sectorTimes || { S1: null, S2: null, S3: null },
        lastSectorTimes: d.lastSectorTimes || { S1: null, S2: null, S3: null }

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

    const raceConfig = {
      circuitId: String(req.body.circuitId),
      totalLaps: Number(req.body.totalLaps || 10),
      assignments: req.body.assignments || {},
      pilots: req.body.pilots || []
    };

    Race.start(raceConfig);

    // 🔴 Avvia registrazione della gara
    const raceId = Race.getCurrentRaceId();
    recorder.startRecording(raceId, raceConfig);

    broadcastJSON(Race.initPayload()); // sectors una volta
    const t0 = performance.now();
    const snap = Race.snapshot();
    broadcastJSON(snap);
    res.json({
      ok: true,
      raceId: raceId,
      snapshot: snap,
      lastSnapshotBuildMs: +(performance.now() - t0).toFixed(2)
    });
  } catch (e) {
    console.error('[RACE] start error', e.message);
    res.status(400).json({ error: e.message });
  }
});
app.post('/api/race/stop', (_req, res) => {
  const raceId = Race.getCurrentRaceId();
  const finalSnapshot = Race.snapshot();
  const stoppedRaceId = Race.stop();

  // 🔴 Termina registrazione della gara
  if (stoppedRaceId && recorder.isRecording(stoppedRaceId)) {
    recorder.stopRecording(stoppedRaceId, finalSnapshot);
  }

  broadcastJSON({ type: 'race_inactive' });
  res.json({ ok: true, raceId: stoppedRaceId });
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

/* ==== API Registrazioni ==== */
app.get('/api/recordings', (_req, res) => {
  try {
    const recordings = recorder.listRecordings();
    res.json({ ok: true, recordings });
  } catch (e) {
    console.error('[RECORDINGS] Errore:', e.message);
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/recordings/:folder', (req, res) => {
  try {
    const folder = req.params.folder;
    const recordings = recorder.listRecordings();
    const recording = recordings.find(r => r.folder === folder);

    if (!recording) {
      return res.status(404).json({ error: 'Registrazione non trovata' });
    }

    res.json({ ok: true, recording });
  } catch (e) {
    console.error('[RECORDINGS] Errore:', e.message);
    res.status(500).json({ error: e.message });
  }
});

app.listen(PORT, () => {
  console.log(`RACESENSE server running on port ${PORT}`);
  console.log(`Health: http://localhost:${PORT}/health`);
  console.log(`WebSocket server on port ${WS_PORT}`);
  console.log(`UDP GPS listener on port ${UDP_PORT}`);
});
