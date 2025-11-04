// raceRecorder.js - Sistema di registrazione gare leggero e robusto
const fs = require('fs');
const path = require('path');

// Cartella per le registrazioni
const RECORDINGS_DIR = path.join(__dirname, 'recordings');
if (!fs.existsSync(RECORDINGS_DIR)) {
  fs.mkdirSync(RECORDINGS_DIR, { recursive: true });
}

// Mappa delle gare attive (key: raceId, value: recording object)
const activeRecordings = new Map();

/**
 * Inizia la registrazione di una gara
 * @param {string} raceId - ID univoco della gara
 * @param {object} raceConfig - Configurazione iniziale della gara
 * @returns {object|null} - Oggetto recording o null in caso di errore
 */
function startRecording(raceId, raceConfig = {}) {
  try {
    // Crea timestamp pulito per il nome della cartella
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
    const raceName = `${raceId}_${timestamp}`;
    const raceDir = path.join(RECORDINGS_DIR, raceName);
    
    // Crea la cartella per questa gara
    fs.mkdirSync(raceDir, { recursive: true });
    
    // Crea l'oggetto di registrazione
    const recording = {
      raceId: raceId,
      raceName: raceName,
      raceDir: raceDir,
      dataFilePath: path.join(raceDir, 'packets.jsonl'),
      configFilePath: path.join(raceDir, 'config.json'),
      packetCount: 0,
      startTime: new Date().toISOString(),
      lastPacketTime: null
    };
    
    // Salva la configurazione iniziale
    const configData = {
      raceId: raceId,
      startTime: recording.startTime,
      config: raceConfig
    };
    fs.writeFileSync(recording.configFilePath, JSON.stringify(configData, null, 2));
    
    // Registra nella mappa
    activeRecordings.set(raceId, recording);
    
    console.log(`📹 Registrazione gara "${raceId}" avviata → ${raceDir}`);
    return recording;
    
  } catch (err) {
    console.error('❌ Errore creazione registrazione:', err.message);
    return null;
  }
}

/**
 * Registra un pacchetto GPS durante la gara (operazione NON-BLOCKING)
 * @param {string} raceId - ID della gara
 * @param {object} packet - Dati del pacchetto GPS
 */
function recordPacket(raceId, packet) {
  const recording = activeRecordings.get(raceId);
  if (!recording) {
    // Gara non in registrazione, ignora silenziosamente
    return;
  }

  try {
    const now = Date.now();
    
    // Formato compatto: timestamp + dati (JSON Lines)
    const line = JSON.stringify({
      t: now,
      d: packet
    }) + '\n';
    
    // Scrivi in append mode NON-BLOCKING
    fs.appendFile(recording.dataFilePath, line, (err) => {
      if (err) {
        console.error('⚠️ Errore scrittura pacchetto:', err.message);
      } else {
        recording.packetCount++;
        recording.lastPacketTime = now;
      }
    });
    
  } catch (err) {
    console.error('⚠️ Errore registrazione pacchetto:', err.message);
  }
}

/**
 * Termina la registrazione di una gara e salva il riepilogo
 * @param {string} raceId - ID della gara
 * @param {object} finalData - Dati finali della gara (opzionale)
 * @returns {object|null} - Summary della registrazione o null
 */
function stopRecording(raceId, finalData = {}) {
  const recording = activeRecordings.get(raceId);
  if (!recording) {
    console.warn(`⚠️ Nessuna registrazione attiva per gara "${raceId}"`);
    return null;
  }

  try {
    const endTime = new Date().toISOString();
    const duration = recording.lastPacketTime 
      ? Math.round((recording.lastPacketTime - new Date(recording.startTime).getTime()) / 1000)
      : 0;
    
    // Crea il riepilogo finale
    const summary = {
      raceId: recording.raceId,
      raceName: recording.raceName,
      startTime: recording.startTime,
      endTime: endTime,
      durationSeconds: duration,
      packetCount: recording.packetCount,
      finalData: finalData
    };
    
    // Salva il riepilogo
    const summaryPath = path.join(recording.raceDir, 'summary.json');
    fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2));
    
    // Rimuovi dalla mappa
    activeRecordings.delete(raceId);
    
    console.log(`✅ Registrazione gara "${raceId}" terminata:`);
    console.log(`   📦 ${recording.packetCount} pacchetti salvati`);
    console.log(`   ⏱️  Durata: ${duration}s`);
    console.log(`   📁 ${recording.raceDir}`);
    
    return summary;
    
  } catch (err) {
    console.error('❌ Errore chiusura registrazione:', err.message);
    activeRecordings.delete(raceId);
    return null;
  }
}

/**
 * Verifica se una gara è attualmente in registrazione
 * @param {string} raceId - ID della gara
 * @returns {boolean}
 */
function isRecording(raceId) {
  return activeRecordings.has(raceId);
}

/**
 * Ottieni informazioni su una registrazione attiva
 * @param {string} raceId - ID della gara
 * @returns {object|null}
 */
function getRecordingInfo(raceId) {
  const recording = activeRecordings.get(raceId);
  if (!recording) return null;
  
  return {
    raceId: recording.raceId,
    raceName: recording.raceName,
    startTime: recording.startTime,
    packetCount: recording.packetCount,
    lastPacketTime: recording.lastPacketTime,
    isActive: true
  };
}

/**
 * Ottieni lista di tutte le registrazioni disponibili
 * @returns {array} - Array di oggetti con info sulle registrazioni
 */
function listRecordings() {
  try {
    if (!fs.existsSync(RECORDINGS_DIR)) return [];
    
    const folders = fs.readdirSync(RECORDINGS_DIR)
      .filter(f => fs.statSync(path.join(RECORDINGS_DIR, f)).isDirectory());
    
    return folders.map(folder => {
      const summaryPath = path.join(RECORDINGS_DIR, folder, 'summary.json');
      const configPath = path.join(RECORDINGS_DIR, folder, 'config.json');
      
      let summary = null;
      let config = null;
      
      try {
        if (fs.existsSync(summaryPath)) {
          summary = JSON.parse(fs.readFileSync(summaryPath, 'utf8'));
        }
        if (fs.existsSync(configPath)) {
          config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
        }
      } catch (e) {
        // Ignora errori di parsing
      }
      
      return {
        folder: folder,
        path: path.join(RECORDINGS_DIR, folder),
        summary: summary,
        config: config
      };
    }).sort((a, b) => {
      // Ordina per data più recente
      const timeA = a.summary?.startTime || a.config?.startTime || '';
      const timeB = b.summary?.startTime || b.config?.startTime || '';
      return timeB.localeCompare(timeA);
    });
    
  } catch (err) {
    console.error('Errore lettura registrazioni:', err.message);
    return [];
  }
}

module.exports = {
  startRecording,
  recordPacket,
  stopRecording,
  isRecording,
  getRecordingInfo,
  listRecordings,
  RECORDINGS_DIR
};
