# 🏎️ RACESENSE - Sistema di Race Live con GPS

## 🚀 Avvio Rapido

### 1️⃣ **Backend** (con WebSocket + UDP listener)

```bash
cd racesense-backend
npm install
npm start
```

Il backend espone:
- **HTTP API**: `http://localhost:5000`
- **WebSocket**: `ws://localhost:5001` (stream GPS live)
- **UDP Listener**: porta `8888` (riceve pacchetti GPS)

---

### 2️⃣ **Frontend**

```bash
cd racesense-frontend
npm install
npm start
```

Frontend disponibile su `http://localhost:3000`

---

### 3️⃣ **Simulatore GPS** (Python)

Il file `tracksimulator.py` invia pacchetti GPS via UDP simulando dispositivi in movimento sul circuito.

#### Esempio di utilizzo:

```bash
cd racesense-backend

# Simula 5 dispositivi sul circuito di Ferrara
python3 tracksimulator.py \
  --file data/circuiti/2025-10-23T13-39-40-000Z__tracciato-ferrara-gara.json \
  --devices 5 \
  --host 127.0.0.1 \
  --port 8888 \
  --min-speed 25 \
  --max-speed 60 \
  --hz 10
```

**Parametri:**
- `--file`: Percorso al file JSON del tracciato
- `--devices`: Numero di dispositivi GPS da simulare (default: 5)
- `--host`: IP server UDP (default: 127.0.0.1)
- `--port`: Porta UDP (default: 8888)
- `--min-speed`: Velocità minima in km/h (default: 10)
- `--max-speed`: Velocità massima in km/h (default: 40)
- `--hz`: Frequenza invio pacchetti GPS (default: 15 Hz)
- `--no-loop`: Non ricircolare sul tracciato (si ferma all'ultimo punto)

---

## 🏁 Come Funziona il Sistema Race Live

### **Architettura**

```
Dispositivi GPS/Simulatore → UDP :8888 → Backend Node.js → WebSocket :5001 → Frontend React
                                           ↓
                                    Broadcast a tutti i client
```

### **Formato Pacchetti GPS (UDP)**

Il simulatore invia stringhe nel formato:
```
MAC/LAT/LON/SATS/QUAL/SPEED_KMH/YYMMDDhhmmss/CPUTEMP
```

Esempio:
```
A1B2C3D4E5F6/+44.8316642/-11.2238365/15/5/45.3/241030142530/62.5
```

**Campi:**
- `MAC`: Indirizzo MAC dispositivo (es: `A1B2C3D4E5F6`)
- `LAT`: Latitudine (gradi decimali, ±)
- `LON`: Longitudine (gradi decimali, ±)
- `SATS`: Numero satelliti GPS
- `QUAL`: Qualità segnale GPS (0-9)
- `SPEED_KMH`: Velocità in km/h
- `YYMMDDhhmmss`: Timestamp UTC (formato compatto)
- `CPUTEMP`: Temperatura CPU (opzionale)

---

### **Frontend Race Page - Funzionalità**

#### ⚙️ **Setup Gara**
1. Seleziona circuito dal dropdown
2. Visualizza statistiche (lunghezza, larghezza, settori)
3. Click su "🚦 AVVIA GARA"

#### 🏎️ **Vista Live**
- **Canvas interattivo**: Mostra tracciato con piloti in movimento
- **Pallini colorati**: Ogni pilota ha colore univoco
- **Scie (trails)**: Ultimi 20 punti GPS per visualizzare traiettoria
- **Velocità**: Numero sopra ogni pilota
- **Linea traguardo**: Animata con pattern a scacchi

#### 🏆 **Classifica in Tempo Reale**
- Ordinamento per giri completati + settore progressivo
- Leader con badge 👑 dorato
- Visualizza:
  - Posizione
  - Nome pilota (basato su MAC)
  - Giro corrente
  - Settore attuale
  - Velocità istantanea
  - Miglior tempo sul giro

#### 📊 **Sistema di Settori**
Il file JSON del circuito contiene array `sectors` con:
```json
{
  "idx": 0,
  "lat": 44.831664193,
  "lon": 11.223836528,
  "dist": 0
}
```

Il sistema:
1. Trova settore più vicino alla posizione GPS (algoritmo Haversine)
2. Rileva passaggio linea traguardo quando `lastSectorIdx > 750 && currentSectorIdx < 10`
3. Calcola tempo giro: `(now - lapStartTime) / 1000` secondi
4. Aggiorna miglior giro se inferiore al precedente

---

## 🎨 **Stile F1**

### **Palette Colori**
- **Rosso F1**: `#e10600` (header, indicatori live)
- **Verde bandiera**: `#15c130` (velocità, bottone start)
- **Oro leader**: `#ffd700` (primo in classifica)
- **Sfondo scuro**: `#0a0e1a` → `#1a2332` (gradiente)

### **Font**
- `Roboto Mono` (monospace per timer e dati telemetrici)

### **Animazioni**
- Pulsazione indicatore LIVE
- Alone pulsante sui piloti
- Slide-in elementi classifica
- Rotazione badge 👑 leader

---

## 📁 **Struttura File Circuito JSON**

```json
{
  "id": "tracciato-id",
  "name": "Nome Tracciato",
  "createdAt": "2025-10-23T13:39:40Z",
  "meta": {
    "points": 761,
    "sectors": 761
  },
  "params": {
    "widthMeters": 6,
    "spacingMeters": 1,
    "minQual": 3
  },
  "stats": {
    "lengthMeters": 760.93
  },
  "pathPoints": [
    {
      "lat": 44.831664193,
      "lon": 11.223836528,
      "qual": 5
    }
  ],
  "sectors": [
    {
      "idx": 0,
      "lat": 44.831664193,
      "lon": 11.223836528,
      "dist": 0
    }
  ]
}
```

---

## 🔧 **Variabili d'Ambiente**

### Backend (`.env`)
```env
PORT=5000
WS_PORT=5001
UDP_PORT=8888
NODE_ENV=development
```

### Frontend (`.env`)
```env
REACT_APP_API_BASE=http://localhost:5000
REACT_APP_WS_URL=ws://localhost:5001
```

---

## 🧪 **Test Completo**

### Scenario: 5 piloti sul circuito di Ferrara

**Terminal 1 - Backend:**
```bash
cd racesense-backend
npm start
```

**Terminal 2 - Frontend:**
```bash
cd racesense-frontend
npm start
```

**Terminal 3 - Simulatore:**
```bash
cd racesense-backend
python3 tracksimulator.py \
  --file data/circuiti/2025-10-23T13-39-40-000Z__tracciato-ferrara-gara.json \
  --devices 5 \
  --min-speed 30 \
  --max-speed 70 \
  --hz 15
```

**Browser:**
1. Vai su `http://localhost:3000`
2. Click su "Race Live"
3. Seleziona "tracciato ferrara (raffinato per gara)"
4. Click "🚦 AVVIA GARA"
5. Osserva i 5 piloti muoversi sul tracciato in tempo reale!

---

## 📊 **Metriche Performance**

- **Frequenza GPS**: 5-15 Hz per dispositivo
- **Latenza WebSocket**: < 50ms
- **Rendering Canvas**: 60 FPS (requestAnimationFrame)
- **Max piloti simultanei testati**: 20

---

## 🐛 **Troubleshooting**

### WebSocket non si connette
- Verifica che il backend sia avviato su porta 5001
- Controlla firewall/antivirus
- Usa DevTools → Network → WS per diagnosticare

### Nessun pilota visualizzato
- Controlla che il simulatore sia in esecuzione
- Verifica porta UDP 8888 libera: `netstat -an | grep 8888`
- Guarda console backend per log `[GPS]`

### Tracciato non disegnato
- Assicurati che il file JSON contenga `pathPoints` non vuoto
- Controlla console browser per errori

---

## 🎯 **Prossimi Sviluppi**

- [ ] Replay gara da file log
- [ ] Telemetria avanzata (G-force, temperatura pneumatici)
- [ ] Sistema di penalità automatiche
- [ ] Esportazione dati gara in CSV/JSON
- [ ] Integrazione con hardware GPS reale (ESP32, Arduino)

---

## 📝 **License**

MIT - Sviluppato per RACESENSE Platform

---

## 👨‍💻 **Credits**

- **Backend**: Node.js + Express + WebSocket
- **Frontend**: React 19 + Canvas API
- **Simulatore**: Python 3 con geodesia sferica
- **Design**: Ispirato a F1 TV Graphics

🏁 **Buona corsa!**
