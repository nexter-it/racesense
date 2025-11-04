# 📹 Sistema di Registrazione Gare

Il sistema di registrazione salva **automaticamente** tutti i pacchetti GPS ricevuti durante ogni gara.

## Come Funziona

### 🚀 Avvio Automatico
Quando avvii una gara con `POST /api/race/start`, il sistema:
- Crea automaticamente un ID univoco per la gara
- Genera una cartella in `recordings/` con timestamp
- Inizia a salvare tutti i pacchetti GPS in tempo reale

### 💾 Salvataggio
- **Formato**: JSON Lines (`.jsonl`) - un pacchetto per riga
- **Modalità**: Append NON-BLOCKING (non rallenta il server)
- **Sicurezza**: Scritture atomiche, nessuna corruzione dati

### 🏁 Stop Automatico
Quando fermi la gara con `POST /api/race/stop`, il sistema:
- Chiude il file di registrazione
- Salva un riepilogo con statistiche
- Libera la memoria

## Struttura File

Ogni gara viene salvata in una cartella separata:

```
recordings/
├── race_1730000000000_abc123_2025-11-03T14-30-00/
│   ├── config.json          # Configurazione iniziale
│   ├── packets.jsonl        # Tutti i pacchetti GPS
│   └── summary.json         # Riepilogo finale
├── race_1730000100000_def456_2025-11-03T15-45-30/
│   ├── config.json
│   ├── packets.jsonl
│   └── summary.json
└── ...
```

### 📄 File Contenuti

#### `config.json`
```json
{
  "raceId": "race_1730000000000_abc123",
  "startTime": "2025-11-03T14:30:00.000Z",
  "config": {
    "circuitId": "tracciato-rubiera-n-1",
    "totalLaps": 10,
    "assignments": {
      "AA:BB:CC:DD:EE:FF": "pilot_001"
    },
    "pilots": [...]
  }
}
```

#### `packets.jsonl`
```jsonl
{"t":1730000001234,"d":{"mac":"AA:BB:CC:DD:EE:FF","lat":44.1234,"lon":10.5678,"speedKmh":45.2,...}}
{"t":1730000001334,"d":{"mac":"AA:BB:CC:DD:EE:FF","lat":44.1235,"lon":10.5679,"speedKmh":46.1,...}}
{"t":1730000001434,"d":{"mac":"AA:BB:CC:DD:EE:FF","lat":44.1236,"lon":10.5680,"speedKmh":47.3,...}}
```

Dove:
- `t` = timestamp in millisecondi
- `d` = dati completi del pacchetto GPS + IMU

**Formato pacchetto completo:**
```json
{
  "t": 1730000001234,
  "d": {
    "mac": "AA:BB:CC:DD:EE:FF",
    "lat": 44.123456,
    "lon": 10.567890,
    "sats": 12,
    "qual": 2,
    "speedKmh": 45.2,
    "ts": "251104143000",
    "receivedAt": 1730000001234,
    "accel": {
      "x": 0.5,
      "y": -0.3,
      "z": 9.8
    },
    "gyro": {
      "x": 0.01,
      "y": 0.02,
      "z": -0.01
    },
    "mag": {
      "x": 25.3,
      "y": -12.1,
      "z": 43.2
    },
    "quat": {
      "i": 0.0,
      "j": 0.0,
      "k": 0.0,
      "r": 1.0
    },
    "euler": {
      "roll": 2.5,
      "pitch": -1.3,
      "yaw": 135.7
    }
  }
}
```

**Note:**
- I dati IMU (accel, gyro, mag, quat, euler) sono presenti solo se inviati dall'hardware
- Il frontend usa solo i dati GPS base (lat, lon, speedKmh)
- Tutti i dati IMU vengono salvati nelle registrazioni per analisi successive

#### `summary.json`
```json
{
  "raceId": "race_1730000000000_abc123",
  "raceName": "race_1730000000000_abc123_2025-11-03T14-30-00",
  "startTime": "2025-11-03T14:30:00.000Z",
  "endTime": "2025-11-03T15:00:00.000Z",
  "durationSeconds": 1800,
  "packetCount": 18000,
  "finalData": {
    "type": "race_snapshot",
    "drivers": [...],
    ...
  }
}
```

## API Endpoints

### 📋 Lista Tutte le Registrazioni
```bash
GET /api/recordings
```

Risposta:
```json
{
  "ok": true,
  "recordings": [
    {
      "folder": "race_1730000000000_abc123_2025-11-03T14-30-00",
      "path": "/path/to/recordings/race_...",
      "summary": {...},
      "config": {...}
    }
  ]
}
```

### 📂 Dettagli Singola Registrazione
```bash
GET /api/recordings/:folder
```

## Analisi Dati

### Leggere i Pacchetti (Node.js)
```javascript
const fs = require('fs');
const readline = require('readline');

async function readRace(packetsPath) {
  const fileStream = fs.createReadStream(packetsPath);
  const rl = readline.createInterface({
    input: fileStream,
    crlfDelay: Infinity
  });

  for await (const line of rl) {
    const packet = JSON.parse(line);
    console.log(`Time: ${packet.t}, MAC: ${packet.d.mac}, Speed: ${packet.d.speedKmh}`);
  }
}

readRace('./recordings/race_.../packets.jsonl');
```

### Statistiche Rapide (Bash)
```bash
# Contare pacchetti
wc -l packets.jsonl

# Primi 10 pacchetti
head -n 10 packets.jsonl

# Ultimi 10 pacchetti
tail -n 10 packets.jsonl

# Pacchetti di un MAC specifico
grep "AA:BB:CC:DD:EE:FF" packets.jsonl
```

### Conversione in JSON Array (Python)
```python
import json

packets = []
with open('packets.jsonl', 'r') as f:
    for line in f:
        packets.append(json.loads(line))

# Salva come array JSON
with open('packets_array.json', 'w') as f:
    json.dump(packets, f, indent=2)
```

## Caratteristiche

✅ **Leggero**: Scrittura non-blocking, zero impatto sulle performance  
✅ **Robusto**: Nessuna corruzione dati, scritture atomiche  
✅ **Efficiente**: Formato compatto JSON Lines  
✅ **Automatico**: Nessuna configurazione richiesta  
✅ **Completo**: Salva TUTTI i pacchetti GPS ricevuti  
✅ **Organizzato**: Una cartella per gara con timestamp  

## Note Tecniche

- **Formato JSON Lines**: Più efficiente di un array JSON gigante
- **Append File**: Operazione atomica del filesystem
- **Non-Blocking**: Le scritture non bloccano il thread principale
- **Compressione Chiavi**: `t` e `d` invece di `timestamp` e `data` per risparmiare spazio
- **Backup**: Copia manualmente la cartella `recordings/` per backup

## Manutenzione

### Pulizia Vecchie Registrazioni
```bash
# Trova registrazioni più vecchie di 30 giorni
find ./recordings -type d -mtime +30

# Elimina registrazioni più vecchie di 30 giorni
find ./recordings -type d -mtime +30 -exec rm -rf {} \;
```

### Spazio Occupato
```bash
# Controlla spazio totale
du -sh recordings/

# Controlla per singola gara
du -sh recordings/race_*/
```

## Troubleshooting

### La registrazione non parte
- Verifica che la cartella `recordings/` esista (viene creata automaticamente)
- Controlla i permessi di scrittura
- Verifica i log del server

### File troppo grandi
- Una gara di 30 minuti a 20Hz genera ~36.000 righe
- Dimensione stimata: ~100-200 MB per gara (dipende dal numero di piloti)
- Considera di comprimere vecchie registrazioni:
  ```bash
  gzip recordings/race_*/packets.jsonl
  ```

### Recupero dati corrotti
- Il formato JSON Lines permette di recuperare anche file parzialmente corrotti
- Ogni riga è indipendente, quindi errori in una riga non compromettono le altre
