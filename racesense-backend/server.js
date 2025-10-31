const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const dgram = require('dgram');
const { WebSocketServer } = require('ws');
const http = require('http');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 5000;
const UDP_PORT = process.env.UDP_PORT || 8888;
const WS_PORT = process.env.WS_PORT || 5001;

/* ==== CORS (aperto in dev) ==== */
const corsOptions = {
  origin: true,
  credentials: true,
  methods: ['GET','POST','PUT','PATCH','DELETE','OPTIONS'],
  allowedHeaders: ['Content-Type','Authorization'],
};
app.use(cors(corsOptions));
app.options('*', cors(corsOptions));

app.use(express.json());

/* ==== Logger semplice ==== */
app.use((req, _res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
  next();
});

/* ==== Health & Root ==== */
app.get('/health', (req, res) => {
  res.status(200).json({ ok: true, port: PORT, env: process.env.NODE_ENV || 'development' });
});
app.get('/', (req, res) => {
  res.json({ message: 'Benvenuto in RACESENSE', version: '1.0.0' });
});

/* ==== Persistenza Piloti (come già fatto) ==== */
const DATA_DIR = path.join(__dirname, 'data');
const UPLOAD_DIR = path.join(__dirname, 'uploads');
const PILOTS_DB = path.join(DATA_DIR, 'pilots.json');

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
    cb(null, `${Date.now()}_${Math.random().toString(36).slice(2,8)}_${base}${ext}`);
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
      championships: (championships || []).map(s => String(s).trim()),
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
    toDel.forEach(fp => { if (fp.startsWith(UPLOAD_DIR) && fs.existsSync(fp)) fs.unlink(fp, () => {}); });

    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Errore nella cancellazione' });
  }
});

/* ==== API Circuiti (lettura da data/circuiti/*.json) ==== */
const CIRCUITS_DIR = path.join(DATA_DIR, 'circuiti');

function safeReadJSON(fullPath) {
  try {
    const raw = fs.readFileSync(fullPath, 'utf8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/** Lista circuiti (metadata) */
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
    }).filter(Boolean).sort((a,b) => String(b.createdAt||'').localeCompare(String(a.createdAt||'')));
    res.json(list);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Errore lettura circuiti' });
  }
});

/** Dettaglio circuito per id (cerca su campo id o nome file) */
app.get('/api/circuits/:id', (req, res) => {
  try {
    if (!fs.existsSync(CIRCUITS_DIR)) return res.status(404).json({ error: 'Cartella circuiti non trovata' });
    const files = fs.readdirSync(CIRCUITS_DIR).filter(f => f.toLowerCase().endsWith('.json'));

    // 1) prova match diretto sul filename
    let file = files.find(f => path.basename(f, '.json') === req.params.id);

    // 2) se non trovato, cerca dentro i file il campo id corrispondente
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

/* ==== WebSocket Server per GPS Live ==== */
const server = http.createServer(app);
const wss = new WebSocketServer({ port: WS_PORT });

const wsClients = new Set();
wss.on('connection', (ws) => {
  console.log(`[WS] Client connesso. Totale: ${wss.clients.size}`);
  wsClients.add(ws);
  ws.on('close', () => {
    wsClients.delete(ws);
    console.log(`[WS] Client disconnesso. Totale: ${wss.clients.size}`);
  });
  ws.on('error', (err) => console.error('[WS] Errore:', err.message));
});

function broadcastGPS(data) {
  const msg = JSON.stringify(data);
  wsClients.forEach(client => {
    if (client.readyState === 1) { // OPEN
      try { client.send(msg); } catch (e) { console.error('[WS] Send error:', e.message); }
    }
  });
}

/* ==== UDP Listener per pacchetti GPS (formato tracksimulator.py) ==== */
const udpServer = dgram.createSocket('udp4');

udpServer.on('message', (msg, rinfo) => {
  try {
    // Formato: MAC/LAT/LON/SATS/QUAL/SPEED_KMH/YYMMDDhhmmss[/CPUTEMP]
    const line = msg.toString('utf8').trim();
    const parts = line.split('/');
    if (parts.length < 7) return;

    const [mac, latStr, lonStr, satsStr, qualStr, speedStr, ts, cpuTempStr] = parts;
    
    const gpsData = {
      mac: mac.toUpperCase(),
      lat: parseFloat(latStr),
      lon: parseFloat(lonStr),
      sats: parseInt(satsStr) || 0,
      qual: parseInt(qualStr) || 0,
      speedKmh: parseFloat(speedStr) || 0,
      ts: ts || null,
      cpuTemp: cpuTempStr ? parseFloat(cpuTempStr) : null,
      receivedAt: new Date().toISOString()
    };

    // Broadcast ai client WebSocket
    broadcastGPS(gpsData);
    
    // Log opzionale (commentare in produzione per performance)
    // console.log(`[GPS] ${mac} @ ${gpsData.lat.toFixed(6)},${gpsData.lon.toFixed(6)} | ${gpsData.speedKmh.toFixed(1)} km/h`);
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

app.listen(PORT, () => {
  console.log(`RACESENSE server running on port ${PORT}`);
  console.log(`Health: http://localhost:${PORT}/health`);
  console.log(`WebSocket server on port ${WS_PORT}`);
  console.log(`UDP GPS listener on port ${UDP_PORT}`);
});
