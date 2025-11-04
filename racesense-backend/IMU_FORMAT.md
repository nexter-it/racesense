# 📡 Formato Pacchetti UDP - Documentazione IMU

## Formato Pacchetto UDP

```
MAC/±DD.dddddd7/±DDD.dddddd7/ss/q/vv.v/YYMMDDhhmmss/ax/ay/az/gx/gy/gz/mx/my/mz/qi/qj/qk/qr/roll/pitch/yaw
```

### Campi (23 totali)

| Posizione | Campo | Descrizione | Unità | Esempio |
|-----------|-------|-------------|-------|---------|
| 0 | MAC | Indirizzo MAC del dispositivo | - | `AA:BB:CC:DD:EE:FF` |
| 1 | LAT | Latitudine GPS | gradi decimali | `44.1234567` |
| 2 | LON | Longitudine GPS | gradi decimali | `10.5678901` |
| 3 | SATS | Numero satelliti GPS | numero | `12` |
| 4 | QUAL | Qualità segnale GPS | 0-9 | `2` |
| 5 | SPEED | Velocità | km/h | `45.2` |
| 6 | TIMESTAMP | Data/ora | YYMMDDhhmmss | `251104143000` |
| 7 | ACCEL_X | Accelerazione asse X | m/s² | `0.5` |
| 8 | ACCEL_Y | Accelerazione asse Y | m/s² | `-0.3` |
| 9 | ACCEL_Z | Accelerazione asse Z | m/s² | `9.8` |
| 10 | GYRO_X | Velocità angolare asse X | rad/s | `0.01` |
| 11 | GYRO_Y | Velocità angolare asse Y | rad/s | `0.02` |
| 12 | GYRO_Z | Velocità angolare asse Z | rad/s | `-0.01` |
| 13 | MAG_X | Campo magnetico asse X | μT | `25.3` |
| 14 | MAG_Y | Campo magnetico asse Y | μT | `-12.1` |
| 15 | MAG_Z | Campo magnetico asse Z | μT | `43.2` |
| 16 | QUAT_I | Quaternione componente i | - | `0.0` |
| 17 | QUAT_J | Quaternione componente j | - | `0.0` |
| 18 | QUAT_K | Quaternione componente k | - | `0.0` |
| 19 | QUAT_R | Quaternione componente r (reale) | - | `1.0` |
| 20 | ROLL | Angolo di rollio | gradi | `2.5` |
| 21 | PITCH | Angolo di beccheggio | gradi | `-1.3` |
| 22 | YAW | Angolo di imbardata | gradi | `135.7` |

## Dati IMU Spiegati

### 🔵 Accelerometro (accel)
Misura l'accelerazione lineare sui 3 assi in **m/s²**

- **X**: Accelerazione laterale (sinistra/destra)
- **Y**: Accelerazione longitudinale (avanti/indietro)
- **Z**: Accelerazione verticale (su/giù)
  - ~9.8 m/s² quando fermo (gravità)

**Utilizzi:**
- Rilevare curve (accel.x)
- Rilevare frenate/accelerazioni (accel.y)
- Rilevare dossi/salti (accel.z)
- Calcolare forze G

### 🟢 Giroscopio (gyro)
Misura la velocità di rotazione angolare in **rad/s**

- **X**: Rotazione attorno asse X (roll)
- **Y**: Rotazione attorno asse Y (pitch)
- **Z**: Rotazione attorno asse Z (yaw)

**Utilizzi:**
- Rilevare sovrasterzo/sottosterzo
- Misurare velocità di sterzo
- Rilevare testacoda
- Analisi stabilità

### 🟡 Magnetometro (mag)
Misura il campo magnetico terrestre in **μT (microTesla)**

- **X, Y, Z**: Componenti del campo magnetico

**Utilizzi:**
- Calibrazione orientamento
- Determinare direzione assoluta
- Compensazione deriva giroscopio

### 🔴 Quaternione (quat)
Rappresentazione dell'orientamento 3D senza gimbal lock

- **i, j, k**: Componenti immaginarie
- **r**: Componente reale

**Proprietà:**
- i² + j² + k² + r² = 1 (normalizzato)

**Utilizzi:**
- Calcoli di rotazione 3D accurati
- Interpolazione smooth tra orientamenti
- Evitare ambiguità degli angoli di Eulero

### 🟣 Angoli di Eulero (euler)
Orientamento in **gradi** rispetto al sistema di riferimento

- **Roll**: Rollio, rotazione laterale (-180° a +180°)
  - Positivo = inclinazione a destra
  - Negativo = inclinazione a sinistra
  
- **Pitch**: Beccheggio, rotazione longitudinale (-90° a +90°)
  - Positivo = muso in alto
  - Negativo = muso in basso
  
- **Yaw**: Imbardata, rotazione azimutale (0° a 360°)
  - 0° = Nord
  - 90° = Est
  - 180° = Sud
  - 270° = Ovest

**Utilizzi:**
- Visualizzazione orientamento vettura
- Rilevare inclinazione in curva
- Analisi traiettoria e assetto

## Esempi di Analisi

### 🏎️ Forze G in Curva
```javascript
const gLateral = packet.d.accel.x / 9.81;  // G laterali
const gLong = packet.d.accel.y / 9.81;     // G longitudinali
const gTotal = Math.sqrt(gLateral**2 + gLong**2);
console.log(`G-force: ${gTotal.toFixed(2)}g`);
```

### 🌀 Rilevamento Sovrasterzo
```javascript
const yawRate = packet.d.gyro.z * (180 / Math.PI);  // rad/s -> deg/s
if (Math.abs(yawRate) > 50) {
  console.log('⚠️ Possibile sovrasterzo!');
}
```

### 📐 Inclinazione Vettura
```javascript
const roll = packet.d.euler.roll;
console.log(`Inclinazione: ${roll.toFixed(1)}° (${roll > 0 ? 'destra' : 'sinistra'})`);
```

### 🧭 Direzione di Marcia
```javascript
const heading = packet.d.euler.yaw;
const directions = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
const idx = Math.round(heading / 45) % 8;
console.log(`Direzione: ${directions[idx]}`);
```

## Retrocompatibilità

Il server supporta **entrambi** i formati:

### Formato Base (7 campi)
```
MAC/LAT/LON/SATS/QUAL/SPEED/TIMESTAMP
```
- Solo dati GPS
- Nessun dato IMU salvato

### Formato Esteso (23 campi)
```
MAC/LAT/LON/SATS/QUAL/SPEED/TIMESTAMP/ax/ay/az/gx/gy/gz/mx/my/mz/qi/qj/qk/qr/roll/pitch/yaw
```
- Dati GPS + IMU completi
- Tutti i dati salvati nelle registrazioni

## Note Implementazione

### Frontend
- **NON modificato**
- Usa solo: `lat`, `lon`, `speedKmh`
- Ignora dati IMU

### Backend
- **Parser automatico** del formato
- **Salva tutto** nelle registrazioni
- **Retrocompatibile** con vecchio formato

### Registrazioni
- **Dati completi** salvati in `packets.jsonl`
- **Analisi future** con tutti i dati IMU disponibili
- **Script di lettura** mostra statistiche IMU se presenti

## Riferimenti

- **Accelerometro**: Misura accelerazione lineare
- **Giroscopio**: Misura velocità angolare
- **Magnetometro**: Misura campo magnetico
- **Quaternioni**: Rappresentazione orientamento 3D
- **Eulero**: Angoli roll/pitch/yaw classici

## Conversioni Utili

```javascript
// Radianti → Gradi
const degrees = radians * (180 / Math.PI);

// Gradi → Radianti
const radians = degrees * (Math.PI / 180);

// m/s² → G (forza gravitazionale)
const gForce = acceleration / 9.81;

// Normalizza quaternione
const norm = Math.sqrt(i**2 + j**2 + k**2 + r**2);
const normalized = { i: i/norm, j: j/norm, k: k/norm, r: r/norm };
```
