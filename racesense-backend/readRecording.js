#!/usr/bin/env node
/**
 * Script di esempio per leggere e analizzare una registrazione di gara
 * 
 * Uso: node readRecording.js <nome_cartella_gara>
 * 
 * Esempio:
 *   node readRecording.js race_1730000000000_abc123_2025-11-03T14-30-00
 */

const fs = require('fs');
const path = require('path');
const readline = require('readline');

const RECORDINGS_DIR = path.join(__dirname, 'recordings');

async function analyzeRace(raceFolder) {
  const racePath = path.join(RECORDINGS_DIR, raceFolder);
  
  // Verifica esistenza
  if (!fs.existsSync(racePath)) {
    console.error(`❌ Cartella non trovata: ${racePath}`);
    process.exit(1);
  }

  console.log(`\n📁 Analisi gara: ${raceFolder}\n`);

  // Leggi config
  const configPath = path.join(racePath, 'config.json');
  if (fs.existsSync(configPath)) {
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    console.log('🏁 Configurazione:');
    console.log(`   Circuito: ${config.config?.circuitId || 'N/A'}`);
    console.log(`   Giri totali: ${config.config?.totalLaps || 'N/A'}`);
    console.log(`   Avvio: ${config.startTime}`);
    console.log('');
  }

  // Leggi summary
  const summaryPath = path.join(racePath, 'summary.json');
  if (fs.existsSync(summaryPath)) {
    const summary = JSON.parse(fs.readFileSync(summaryPath, 'utf8'));
    console.log('📊 Riepilogo:');
    console.log(`   Pacchetti: ${summary.packetCount?.toLocaleString() || 'N/A'}`);
    console.log(`   Durata: ${summary.durationSeconds || 'N/A'} secondi`);
    console.log(`   Fine: ${summary.endTime}`);
    console.log('');
  }

  // Analizza pacchetti
  const packetsPath = path.join(racePath, 'packets.jsonl');
  if (!fs.existsSync(packetsPath)) {
    console.log('⚠️  Nessun file packets.jsonl trovato');
    return;
  }

  console.log('📦 Analisi pacchetti...\n');

  const stats = {
    totalPackets: 0,
    byMac: {},
    firstTimestamp: null,
    lastTimestamp: null,
    minSpeed: Infinity,
    maxSpeed: -Infinity,
    hasIMU: false,
    imuStats: {
      maxAccel: 0,
      maxGyro: 0,
      maxRoll: -180,
      minRoll: 180,
      maxPitch: -180,
      minPitch: 180
    }
  };

  const fileStream = fs.createReadStream(packetsPath);
  const rl = readline.createInterface({
    input: fileStream,
    crlfDelay: Infinity
  });

  for await (const line of rl) {
    try {
      const packet = JSON.parse(line);
      const { t, d } = packet;
      
      stats.totalPackets++;
      
      if (!stats.firstTimestamp) stats.firstTimestamp = t;
      stats.lastTimestamp = t;
      
      // Statistiche per MAC
      if (!stats.byMac[d.mac]) {
        stats.byMac[d.mac] = {
          packets: 0,
          minSpeed: Infinity,
          maxSpeed: -Infinity,
          avgSpeed: 0,
          totalSpeed: 0
        };
      }
      
      const macStats = stats.byMac[d.mac];
      macStats.packets++;
      macStats.totalSpeed += d.speedKmh || 0;
      macStats.minSpeed = Math.min(macStats.minSpeed, d.speedKmh || 0);
      macStats.maxSpeed = Math.max(macStats.maxSpeed, d.speedKmh || 0);
      
      stats.minSpeed = Math.min(stats.minSpeed, d.speedKmh || 0);
      stats.maxSpeed = Math.max(stats.maxSpeed, d.speedKmh || 0);
      
      // Analizza dati IMU se presenti
      if (d.accel || d.gyro || d.euler) {
        stats.hasIMU = true;
        
        if (d.accel) {
          const accelMag = Math.sqrt(d.accel.x**2 + d.accel.y**2 + d.accel.z**2);
          stats.imuStats.maxAccel = Math.max(stats.imuStats.maxAccel, accelMag);
        }
        
        if (d.gyro) {
          const gyroMag = Math.sqrt(d.gyro.x**2 + d.gyro.y**2 + d.gyro.z**2);
          stats.imuStats.maxGyro = Math.max(stats.imuStats.maxGyro, gyroMag);
        }
        
        if (d.euler) {
          stats.imuStats.maxRoll = Math.max(stats.imuStats.maxRoll, d.euler.roll);
          stats.imuStats.minRoll = Math.min(stats.imuStats.minRoll, d.euler.roll);
          stats.imuStats.maxPitch = Math.max(stats.imuStats.maxPitch, d.euler.pitch);
          stats.imuStats.minPitch = Math.min(stats.imuStats.minPitch, d.euler.pitch);
        }
      }
      
    } catch (e) {
      console.error('Errore parsing riga:', e.message);
    }
  }

  // Calcola medie
  Object.keys(stats.byMac).forEach(mac => {
    const s = stats.byMac[mac];
    s.avgSpeed = s.packets > 0 ? (s.totalSpeed / s.packets).toFixed(2) : 0;
  });

  // Mostra risultati
  console.log('✅ Risultati:');
  console.log(`   Pacchetti totali: ${stats.totalPackets.toLocaleString()}`);
  
  if (stats.firstTimestamp && stats.lastTimestamp) {
    const duration = (stats.lastTimestamp - stats.firstTimestamp) / 1000;
    console.log(`   Durata effettiva: ${duration.toFixed(1)}s`);
    console.log(`   Frequenza media: ${(stats.totalPackets / duration).toFixed(1)} pkt/s`);
  }
  
  console.log(`   Velocità min: ${stats.minSpeed.toFixed(1)} km/h`);
  console.log(`   Velocità max: ${stats.maxSpeed.toFixed(1)} km/h`);
  
  if (stats.hasIMU) {
    console.log('');
    console.log('📊 Dati IMU rilevati:');
    console.log(`   Accelerazione max: ${stats.imuStats.maxAccel.toFixed(2)} m/s²`);
    console.log(`   Velocità angolare max: ${stats.imuStats.maxGyro.toFixed(2)} rad/s`);
    console.log(`   Roll: ${stats.imuStats.minRoll.toFixed(1)}° ↔ ${stats.imuStats.maxRoll.toFixed(1)}°`);
    console.log(`   Pitch: ${stats.imuStats.minPitch.toFixed(1)}° ↔ ${stats.imuStats.maxPitch.toFixed(1)}°`);
  }
  
  console.log('');

  console.log('🏎️  Per pilota:');
  Object.keys(stats.byMac).forEach(mac => {
    const s = stats.byMac[mac];
    console.log(`   ${mac}:`);
    console.log(`      Pacchetti: ${s.packets.toLocaleString()}`);
    console.log(`      Velocità: min=${s.minSpeed.toFixed(1)}, avg=${s.avgSpeed}, max=${s.maxSpeed.toFixed(1)} km/h`);
  });
  console.log('');
}

// Main
const raceFolder = process.argv[2];

if (!raceFolder) {
  console.log('Uso: node readRecording.js <nome_cartella_gara>');
  console.log('');
  console.log('Gare disponibili:');
  
  if (fs.existsSync(RECORDINGS_DIR)) {
    const folders = fs.readdirSync(RECORDINGS_DIR)
      .filter(f => fs.statSync(path.join(RECORDINGS_DIR, f)).isDirectory())
      .sort()
      .reverse();
    
    if (folders.length === 0) {
      console.log('  (nessuna gara registrata)');
    } else {
      folders.forEach(f => console.log(`  - ${f}`));
    }
  } else {
    console.log('  (cartella recordings non trovata)');
  }
  
  process.exit(0);
}

analyzeRace(raceFolder).catch(err => {
  console.error('Errore:', err.message);
  process.exit(1);
});
