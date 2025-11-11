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

// === JITTER BUFFER (configurazione) ===
const JITTER_DELAY_MS = parseInt(process.env.JITTER_DELAY_MS || '2000', 10);   // ritardo fisso
const JITTER_FLUSH_INTERVAL_MS = parseInt(process.env.JITTER_FLUSH_INTERVAL_MS || '10', 10); // tick flush
const JITTER_MAX_QUEUE = parseInt(process.env.JITTER_MAX_QUEUE || '100000', 10); // cap assoluto pacchetti in coda

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

// ==== PULSE WAITLIST (file locale) ====
const PULSE_DB = path.join(DATA_DIR, 'pulse_waitlist.json');
if (!fs.existsSync(PULSE_DB)) fs.writeFileSync(PULSE_DB, JSON.stringify([]), 'utf8');

const readPulse = () => {
  try { return JSON.parse(fs.readFileSync(PULSE_DB, 'utf8')); }
  catch { return []; }
};
const writePulse = (arr) => fs.writeFileSync(PULSE_DB, JSON.stringify(arr, null, 2), 'utf8');

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

// server.js  (sostituisci SOLO il blocco dell'endpoint POST /api/pilots con questo)

app.post('/api/pilots', upload.fields([
  { name: 'photoDriver', maxCount: 1 },
  { name: 'photoTeam', maxCount: 1 }
]), (req, res) => {
  try {
    const { name, surname, team } = req.body;
    if (!name || !surname || !team) {
      return res.status(400).json({ error: 'Campi obbligatori: name, surname, team' });
    }

    const championshipId = String(req.body.championshipId || '').trim();
    const formulaId = String(req.body.formulaId || '').trim();
    if (!championshipId) return res.status(400).json({ error: 'championshipId obbligatorio' });
    if (!formulaId) return res.status(400).json({ error: 'formulaId obbligatorio' });

    let championshipsArr = [];
    try {
      championshipsArr = JSON.parse(fs.readFileSync(CHAMPIONSHIPS_DB, 'utf8'));
    } catch {
      championshipsArr = [];
    }
    const champ = championshipsArr.find(c => String(c.id) === championshipId);
    if (!champ) return res.status(400).json({ error: 'Campionato non trovato' });

    const formulas = Array.isArray(champ.formulas) ? champ.formulas : [];
    const formula = formulas.find(f => String(f.id) === formulaId);
    if (!formula) return res.status(400).json({ error: 'Formula non trovata nel campionato selezionato' });

    const driverFile = req.files?.photoDriver?.[0] || null;
    const teamFile = req.files?.photoTeam?.[0] || null;

    const pilot = {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
      name: String(name).trim(),
      surname: String(surname).trim(),
      team: String(team).trim(),
      championship: { id: champ.id, name: champ.name },
      formula: { id: formula.id, label: formula.label },
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

/* ==== API Pulse: registrazione waitlist ==== */
// POST /api/pulse/register  { name, email, phone }
app.post('/api/pulse/register', (req, res) => {
  try {
    const name = String(req.body?.name || '').trim();
    const email = String(req.body?.email || '').trim().toLowerCase();
    const phone = String(req.body?.phone || '').trim();

    if (!name) return res.status(400).json({ error: 'Nome obbligatorio' });
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email))
      return res.status(400).json({ error: 'Email non valida' });
    if (!phone) return res.status(400).json({ error: 'Telefono obbligatorio' });

    const list = readPulse();

    // evita duplicati per email (case-insensitive)
    if (list.some(e => String(e.email || '').toLowerCase() === email)) {
      return res.status(409).json({ error: 'Email già registrata' });
    }

    const entry = {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
      name,
      email,
      phone,
      ua: String(req.headers['user-agent'] || ''),
      ip: req.headers['x-forwarded-for']?.toString().split(',')[0]?.trim() || req.socket?.remoteAddress || null,
      createdAt: new Date().toISOString()
    };

    list.unshift(entry);
    writePulse(list);

    return res.status(201).json({ ok: true, id: entry.id });
  } catch (err) {
    console.error('[PULSE REGISTER] Errore:', err);
    return res.status(500).json({ error: 'Errore salvataggio registrazione' });
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
      formulas: []
    };

    championships.unshift(newChamp);
    writeChampionships(championships);
    res.json(championships);
  } catch (err) {
    console.error('[CHAMPIONSHIPS] Errore:', err);
    res.status(500).json({ error: 'Errore nel salvataggio campionato' });
  }
});

// POST /api/championships/:id/formulas  -> ritorna il campionato aggiornato
app.post('/api/championships/:id/formulas', (req, res) => {
  try {
    const { id } = req.params;
    const { label } = req.body || {};
    if (!label || !String(label).trim()) {
      return res.status(400).json({ error: 'Label formula obbligatoria' });
    }
    const championships = readChampionships();
    const idx = championships.findIndex(c => c.id === id);
    if (idx === -1) return res.status(404).json({ error: 'Campionato non trovato' });

    const formula = {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      label: String(label).trim(),
      createdAt: new Date().toISOString()
    };
    championships[idx].formulas = Array.isArray(championships[idx].formulas) ? championships[idx].formulas : [];
    championships[idx].formulas.push(formula);
    writeChampionships(championships);
    res.json(championships[idx]);
  } catch (e) {
    console.error('[CH FORMULA POST] Errore:', e);
    res.status(500).json({ error: 'Errore aggiunta formula' });
  }
});

// DELETE /api/championships/:id/formulas/:fid  -> ritorna il campionato aggiornato
app.delete('/api/championships/:id/formulas/:fid', (req, res) => {
  try {
    const { id, fid } = req.params;
    const championships = readChampionships();
    const idx = championships.findIndex(c => c.id === id);
    if (idx === -1) return res.status(404).json({ error: 'Campionato non trovato' });

    const arr = Array.isArray(championships[idx].formulas) ? championships[idx].formulas : [];
    const fidx = arr.findIndex(f => f.id === fid);
    if (fidx === -1) return res.status(404).json({ error: 'Formula non trovata' });

    arr.splice(fidx, 1);
    championships[idx].formulas = arr;
    writeChampionships(championships);
    res.json(championships[idx]);
  } catch (e) {
    console.error('[CH FORMULA DELETE] Errore:', e);
    res.status(500).json({ error: 'Errore eliminazione formula' });
  }
});

// DELETE /api/championships/:id  -> ritorna l'elenco aggiornato
app.delete('/api/championships/:id', (req, res) => {
  try {
    const { id } = req.params;
    const championships = readChampionships();
    const idx = championships.findIndex(c => c.id === id);
    if (idx === -1) return res.status(404).json({ error: 'Campionato non trovato' });

    // elimina file foto se esiste
    const photo = championships[idx].photo;
    if (photo) {
      const p = path.join(__dirname, photo.replace(/^\//, ''));
      if (p.startsWith(UPLOAD_DIR) && fs.existsSync(p)) {
        fs.unlink(p, () => { });
      }
    }

    championships.splice(idx, 1);
    writeChampionships(championships);
    res.json(championships);
  } catch (e) {
    console.error('[CH DELETE] Errore:', e);
    res.status(500).json({ error: 'Errore eliminazione campionato' });
  }
});

/* ==== WebSocket server ==== */
// const server = http.createServer(app);

// perMessageDeflate + backpressure-ready
const wss = new WebSocketServer({
  port: WS_PORT,
  perMessageDeflate: {
    zlibDeflateOptions: { level: 6 },
    clientNoContextTakeover: false,
    serverNoContextTakeover: false
  }
});
const wsClients = new Set();

function installHeartbeat(ws) {
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });
}

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
  installHeartbeat(ws);

  // Handshake iniziale
  try {
    if (Race.isActive()) {
      ws.send(JSON.stringify(Race.initPayload()));
      ws.send(JSON.stringify(Race.snapshot())); // snapshot immediato
    } else {
      ws.send(JSON.stringify({ type: 'race_inactive' }));
    }
  } catch (_) { }

  ws.on('close', () => {
    wsClients.delete(ws);
    console.log(`[WS] Client disconnesso. Totale: ${wss.clients.size}`);
    metrics.wsClients = wss.clients.size;
  });

  ws.on('error', (err) => console.error('[WS] Errore:', err.message));
});

const hb = setInterval(() => {
  wss.clients.forEach((ws) => {
    if (ws.isAlive === false) return ws.terminate();
    ws.isAlive = false;
    try { ws.ping(); } catch { }
  });
}, 30000);
wss.on('close', () => clearInterval(hb));

setInterval(() => {
  metrics.gpsPacketsPerSec = metrics._acc.gpsPackets;
  metrics.wsBytesPerSec = metrics._acc.wsBytes;
  metrics._acc.gpsPackets = 0;
  metrics._acc.wsBytes = 0;
}, 1000);

/* ==== SCHEDULER: TELEMETRIA ~15Hz + SNAPSHOT 1Hz ==== */
let telemetryTimer = null;
let snapshotTimer = null;

function startSchedulers() {
  stopSchedulers();

  telemetryTimer = setInterval(() => {
    const telem = buildTelemetryFrame();
    if (!telem) return;

    // Backpressure: se il client è lento, salta frame vecchi
    const str = JSON.stringify(telem);
    wsClients.forEach(c => {
      if (c.readyState !== 1) return;

      // backpressure hard limit
      if (c.bufferedAmount > 1_000_000) {
        c._skipCount = (c._skipCount || 0) + 1;
        if (c._skipCount > 100) { // ~6-7s a 15Hz
          try { c.terminate(); } catch { }
        }
        return; // salta questo frame
      }

      c._skipCount = 0; // client in salute
      try {
        c.send(str);
        metrics._acc.wsBytes += Buffer.byteLength(str);
      } catch { }
    });
  }, 33); // ~15 Hz

  snapshotTimer = setInterval(() => {
    if (!Race.isActive()) return;
    // Costruiamo lo snapshot solo ora (1Hz)
    const t0 = performance.now();
    const snap = Race.snapshot();
    metrics.lastSnapshotBuildMs = +(performance.now() - t0).toFixed(2);
    _broadcastString(JSON.stringify(snap));
  }, 1000); // 1 Hz
}

function stopSchedulers() {
  if (telemetryTimer) clearInterval(telemetryTimer);
  if (snapshotTimer) clearInterval(snapshotTimer);
  telemetryTimer = null;
  snapshotTimer = null;
  metrics.lastSnapshotBuildMs = 0;
}

function _broadcastString(str) {
  const sz = Buffer.byteLength(str);
  wsClients.forEach(c => {
    if (c.readyState !== 1) return;

    if (c.bufferedAmount && c.bufferedAmount > 1_000_000) {
      c._skipCount = (c._skipCount || 0) + 1;
      // soglia più permissiva perché lo snapshot è raro
      if (c._skipCount > 10) { // ~10s a 1Hz
        try { c.terminate(); } catch { }
      }
      return;
    }

    c._skipCount = 0;
    try { c.send(str); metrics._acc.wsBytes += sz; } catch { }
  });
}

function broadcastJSON(obj) { _broadcastString(JSON.stringify(obj)); }

/* ==== TELEMETRY BUILDER (batch minimale ogni ~66ms) ==== */
function buildTelemetryFrame() {
  if (!Race.isActive()) return null;
  // Prendiamo solo i campi minimi necessari per il disegno fluido
  const drivers = Race.minimalPositions(); // lo aggiungiamo in Race qui sotto
  if (!drivers.length) return null;
  return {
    type: 'telemetry',
    ts: Date.now(),
    drivers // [{ mac, lat, lon, speedKmh }]
  };
}

// Converte YYMMDDhhmmss (UTC) in epoch ms, fallback se non valido
function parseTsToEpochMs(tsYY, fallbackMs) {
  if (!tsYY || tsYY.length !== 12) return fallbackMs;
  const yy = 2000 + parseInt(tsYY.slice(0, 2), 10);
  const MM = parseInt(tsYY.slice(2, 4), 10) - 1;
  const dd = parseInt(tsYY.slice(4, 6), 10);
  const hh = parseInt(tsYY.slice(6, 8), 10);
  const mm = parseInt(tsYY.slice(8, 10), 10);
  const ss = parseInt(tsYY.slice(10, 12), 10);
  const ms = Date.UTC(yy, MM, dd, hh, mm, ss);
  return Number.isFinite(ms) ? ms : fallbackMs;
}

// Stato per jitter buffer
const _jitter = {
  // mac -> { anchorDevMs, anchorSrvMs }
  anchors: new Map(),
  // mac -> Array<{ emitAt:number, devMs:number, gps:object }>
  queues: new Map(),
  // contatore globale per cap
  totalQueued: 0,
  timer: null
};

function _ensureAnchor(mac, devMs, now) {
  let a = _jitter.anchors.get(mac);
  if (!a) {
    a = { anchorDevMs: devMs, anchorSrvMs: now };
    _jitter.anchors.set(mac, a);
  }
  return a;
}

function _enqueueJitter(gps) {
  const now = Date.now();

  // ms opzionali dal device (gps.tms 0..999)
  const baseTs = parseTsToEpochMs(gps.ts, gps.receivedAt || now);
  const ms = Number.isFinite(gps.tms) ? Math.max(0, Math.min(999, gps.tms)) : 0;
  const devMs = baseTs + ms;

  const a = _ensureAnchor(gps.mac, devMs, now);
  const emitAt = a.anchorSrvMs + (devMs - a.anchorDevMs) + JITTER_DELAY_MS;

  const arr = _jitter.queues.get(gps.mac) || [];
  arr.push({ emitAt, devMs, gps });
  _jitter.queues.set(gps.mac, arr);
  _jitter.totalQueued++;

  // Cap assoluto (drop più recente se superiamo)
  if (_jitter.totalQueued > JITTER_MAX_QUEUE) {
    const drop = arr.pop();
    if (drop) _jitter.totalQueued--;
  }
}

function _flushJitter() {
  const now = Date.now();
  _jitter.queues.forEach((arr, mac) => {
    if (!arr.length) return;
    // prendi maturi
    const due = [];
    const keep = [];
    for (const it of arr) ((it.emitAt <= now) ? due : keep).push(it);
    if (due.length) {
      // ordine temporale del device
      due.sort((a, b) => a.devMs - b.devMs);
      for (const it of due) _emitGps(it.gps);
      _jitter.totalQueued -= due.length;
    }
    if (keep.length) _jitter.queues.set(mac, keep); else _jitter.queues.delete(mac);
  });
}

function _emitGps(gps) {
  if (Race.isActive()) {
    Race.applyGPS(gps);
    if (recorder.isRecording(Race.getCurrentRaceId())) {
      recorder.recordPacket(Race.getCurrentRaceId(), gps);
    }
  } else {
    broadcastJSON({ type: 'gps_raw', data: gps });
  }
}

// avvia il timer del jitter buffer
function startJitter() {
  if (_jitter.timer) clearInterval(_jitter.timer);
  _jitter.timer = setInterval(_flushJitter, JITTER_FLUSH_INTERVAL_MS);
}
function stopJitter() {
  if (_jitter.timer) clearInterval(_jitter.timer);
  _jitter.timer = null;
  _jitter.anchors.clear();
  _jitter.queues.clear();
  _jitter.totalQueued = 0;
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

    // --- ms opzionali e retrocompat CPU temp ---
    // Se parts[7] sono ms 0..999, usa gps.tms e sposta cpuTemp a [8]; altrimenti [7] è cpuTemp legacy
    let tmsParsed = false;
    if (parts.length >= 8 && /^\d{1,3}$/.test(parts[7])) {
      gps.tms = parseInt(parts[7], 10) || 0; // 0..999
      tmsParsed = true;
    }
    if (!tmsParsed && parts.length >= 8) {
      gps.cpuTemp = parseFloat(parts[7]) || null;
    } else if (tmsParsed && parts.length >= 9) {
      gps.cpuTemp = parseFloat(parts[8]) || null;
    }

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
    }
    // else if (parts.length >= 8) {
    //   // Retrocompatibilità: cpuTemp (vecchio formato)
    //   gps.cpuTemp = parseFloat(parts[7]) || null;
    // }

    _enqueueJitter(gps);
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
startJitter();

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
  function closestSector(lat, lon, sectors, hintIdx) {
    const toRad = d => d * Math.PI / 180;
    const R = 6371000;
    const hav = (a, b, c, d) => {
      const dLat = toRad(c - a), dLon = toRad(d - b);
      const A = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a)) * Math.cos(toRad(c)) * Math.sin(dLon / 2) ** 2;
      return R * 2 * Math.atan2(Math.sqrt(A), Math.sqrt(1 - A));
    };

    const n = sectors.length;
    if (!n) return 0;

    // finestra locale
    const W = Math.min(25, Math.floor(n / 8)); // adattivo
    let bestIdx = 0, best = Infinity;

    const scan = (start, end) => {
      for (let i = start; i <= end; i++) {
        const s = sectors[(i + n) % n];
        const d = hav(lat, lon, s.lat, s.lon);
        if (d < best) { best = d; bestIdx = (i + n) % n; }
      }
    };

    if (Number.isInteger(hintIdx)) {
      scan(hintIdx - W, hintIdx + W);
      // se non è convincente (>25m), fallback full scan
      if (best > 25) scan(0, n - 1);
    } else {
      scan(0, n - 1);
    }
    return bestIdx;
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
  // ➕ AGGIUNGI: util per calcolare i gap su un array "ordinato" e scriverli in un campo custom
  function computeGapsInto(sorted, field = 'gapToLeader') {
    if (!sorted.length) return;
    const leader = sorted[0];
    sorted.forEach(d => {
      if (d.mac === leader.mac) { d[field] = 'LEADER'; return; }
      if (d.lapCount < leader.lapCount) d[field] = `+${leader.lapCount - d.lapCount}L`;
      else {
        const sectorDiff = leader.sectorIdx - d.sectorIdx;
        const est = Math.max(0, sectorDiff / 10);
        d[field] = `+${est.toFixed(2)}`;
      }
    });
  }

  // ➕ AGGIUNGI: ranking e gap per-formula
  function applyClassStats(sorted) {
    const groups = new Map();
    sorted.forEach(d => {
      const fid = d.formula?.id || 'NO_CLASS';
      if (!groups.has(fid)) groups.set(fid, []);
      groups.get(fid).push(d);
    });

    groups.forEach(arr => {
      // ordina come la generale, ma solo nel gruppo
      const ord = [...arr].sort((a, b) => {
        if (a.lapCount !== b.lapCount) return b.lapCount - a.lapCount;
        return b.sectorIdx - a.sectorIdx;
      });
      ord.forEach((d, i) => { d.classPosition = i + 1; });
      computeGapsInto(ord, 'classGapToLeader');
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

  function minimalPositions() {
    if (!active) return [];
    // Leggiamo direttamente lo stato interno “drivers”
    // NOTA: non ordiniamo, è solo per rendering; si usa la classifica nello snapshot
    return Array.from(drivers.values()).map(d => ({
      mac: d.mac,
      lat: round6(d.lat),
      lon: round6(d.lon),
      speedKmh: round1(d.speed)
    }));
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
      const sectorIdx = closestSector(lat, lon, sectors, (drivers.get(mac)?.lastSectorIdx));
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
        formula: {
          id: pilot.formula?.id || null,
          label: pilot.formula?.label || null
        },
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
      computeGaps(sorted);              // gap generale (già esistente)
      applyClassStats(sorted);          // ➕ nuovo: gap e posizione di classe
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
          formula: d.formula ? { id: d.formula.id, label: d.formula.label } : { id: null, label: null },
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
          classPosition: d.classPosition || null,
          classGapToLeader: d.classGapToLeader || null,
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
        formula: d.formula ? { id: d.formula.id, label: d.formula.label } : { id: null, label: null },
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
    minimalPositions,
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
    startSchedulers();

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

  stopSchedulers();
  stopJitter(); startJitter();
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
    // try { _broadcastString(JSON.stringify(Race.snapshot())); } catch { }
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
    // try { _broadcastString(JSON.stringify(Race.snapshot())); } catch { }
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
