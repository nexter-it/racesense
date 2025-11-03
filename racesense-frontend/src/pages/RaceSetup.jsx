// src/pages/RaceSetup.jsx
import React, { useState, useEffect, useRef } from 'react';
import '../App.css';

const API_BASE = process.env.REACT_APP_API_BASE || `http://${window.location.hostname}:5000`;
const WS_URL = process.env.REACT_APP_WS_URL || `ws://${window.location.hostname}:5001`;

export default function RaceSetup({ onStartRace }) {
  const [circuits, setCircuits] = useState([]);
  const [pilots, setPilots] = useState([]);

  const [selectedCircuit, setSelectedCircuit] = useState(null);
  const [circuitData, setCircuitData] = useState(null);

  const [totalLaps, setTotalLaps] = useState(10);

  const [activeDevices, setActiveDevices] = useState({});
  const [deviceAssignments, setDeviceAssignments] = useState({});

  // 🔔 snapshot se gara attiva: banner immediato in /race
  const [raceInProgress, setRaceInProgress] = useState(null);

  const wsRef = useRef(null);
  const deviceTimeoutRef = useRef({});

  // --- bootstrap dati + stato gara attuale ---
  useEffect(() => {
    fetch(`${API_BASE}/api/circuits`).then(r => r.json()).then(setCircuits).catch(console.error);
    fetch(`${API_BASE}/api/pilots`).then(r => r.json()).then(setPilots).catch(console.error);

    // 👉 check immediato: c’è una gara già attiva?
    fetch(`${API_BASE}/api/race/state`)
      .then(r => r.json())
      .then(s => { if (s?.type === 'race_snapshot') setRaceInProgress(s); })
      .catch(() => { });
  }, []);

  // --- dettagli circuito selezionato ---
  useEffect(() => {
    if (!selectedCircuit) return;
    fetch(`${API_BASE}/api/circuits/${selectedCircuit}`).then(r => r.json()).then(setCircuitData).catch(console.error);
  }, [selectedCircuit]);

  // --- WebSocket: device liberi + stato gara attuale (banner) ---
  useEffect(() => {
    const ws = new WebSocket(WS_URL);
    wsRef.current = ws;

    ws.onopen = () => console.log('[RaceSetup] WS connesso');
    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);

        if (data?.type === 'race_init') {
          // Banner gara in corso (init arriva all’avvio o alla connessione)
          setRaceInProgress({
            totalLaps: data.totalLaps,
            raceStatus: data.raceStatus,
            circuit: data.circuit
          });
          return;
        }

        if (data?.type === 'race_snapshot') {
          setRaceInProgress(data);
          return;
        }
        if (data?.type === 'race_inactive') {
          setRaceInProgress(null);
          return;
        }

        // gestione preview dei device “liberi” (quando non c’è gara)
        if (data?.type === 'gps_raw' && data?.data?.mac && data?.data?.lat && data?.data?.lon) {
          const { mac, lat, lon, speedKmh } = data.data;
          const speed = Number(speedKmh || 0);
          setActiveDevices(prev => ({
            ...prev,
            [mac]: { lastSeen: Date.now(), lat: Number(lat), lon: Number(lon), speed }
          }));
          if (deviceTimeoutRef.current[mac]) clearTimeout(deviceTimeoutRef.current[mac]);
          deviceTimeoutRef.current[mac] = setTimeout(() => {
            setActiveDevices(prev => { const copy = { ...prev }; delete copy[mac]; return copy; });
          }, 6000);
        }
      } catch { }
    };
    ws.onerror = e => console.error('[RaceSetup] WS errore', e);
    ws.onclose = () => console.log('[RaceSetup] WS chiuso');

    return () => {
      Object.values(deviceTimeoutRef.current).forEach(clearTimeout);
      try { ws.close(); } catch { }
    };
  }, []);

  const assignPilotToDevice = (mac, pilotIdString) => {
    setDeviceAssignments(prev => ({ ...prev, [mac]: pilotIdString }));
  };

  // START: se già attiva mostro banner; se non attiva, avvio.
  const handleStart = async () => {
    try {
      const s = await fetch(`${API_BASE}/api/race/state`).then(r => r.json());
      if (s?.type === 'race_snapshot') { setRaceInProgress(s); return; }

      if (!selectedCircuit) return alert('ATTENZIONE: seleziona un circuito!');
      const assignedDevices = Object.keys(deviceAssignments).filter(mac => deviceAssignments[mac]);
      if (assignedDevices.length === 0) return alert('ATTENZIONE: assegna almeno un pilota a un device attivo!');

      const body = { circuitId: selectedCircuit, totalLaps, assignments: deviceAssignments, pilots };
      const r = await fetch(`${API_BASE}/api/race/start`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error || 'Errore avvio gara');

      onStartRace({ circuit: selectedCircuit, circuitData, totalLaps, assignments: deviceAssignments, pilots });
    } catch (e) {
      console.error(e);
      alert('Errore nell’avvio della gara: ' + e.message);
    }
  };

  const goToExistingRace = async () => {
    try {
      const cid = raceInProgress?.circuit?.id;
      let cData = circuitData;
      if (cid && (!circuitData || selectedCircuit !== cid)) {
        cData = await fetch(`${API_BASE}/api/circuits/${cid}`).then(r => r.json()).catch(() => null);
      }
      onStartRace({
        circuit: cid || selectedCircuit,
        circuitData: cData || circuitData,
        totalLaps: raceInProgress?.totalLaps ?? totalLaps,
        assignments: {},
        pilots
      });
    } catch (e) {
      console.error(e);
      onStartRace({ circuit: selectedCircuit, circuitData, totalLaps, assignments: {}, pilots });
    }
  };

  const activeMacs = Object.keys(activeDevices);
  const selectedStyle = { borderColor: 'rgba(192, 255, 3, 0.55)', boxShadow: '0 0 24px rgba(192,255,3,0.25)' };

  return (
    <div className="main small-top">
      <h2 className="section-title" style={{ marginBottom: 8 }}>Configurazione Gara</h2>
      <p className="subtitle" style={{ marginTop: 0, marginBottom: 24 }}>
        Seleziona il circuito, assegna i piloti ai device e imposta i giri.
      </p>

      {/* 🔔 Banner “gara in corso” — SUBITO alla pagina /race */}
      {raceInProgress && (
        <div className="pilot-form" style={{ color: 'white', borderColor: 'rgba(241,196,15,.4)', background: 'rgba(241,196,15,.08)' }}>
          <b>È già in corso una gara</b> sul circuito <b>{raceInProgress.circuit?.name || raceInProgress.circuit?.id}</b>.
          <div style={{ marginTop: 12, display: 'flex', gap: 8, justifyContent: 'flex-end', flexDirection: 'row-reverse' }}>
            <button className="btn-ghost" onClick={() => setRaceInProgress(null)}>Chiudi avviso</button>
            <button className="btn-primary" onClick={goToExistingRace}>Visualizza gara</button>
          </div>
        </div>
      )}

      {/* Circuiti */}
      <section style={{ marginBottom: 28 }}>
        <h3 className="section-title">Circuito</h3>
        <div className="actions" style={{ marginBottom: 16 }}>
          {circuits.map(c => {
            const isSelected = selectedCircuit === c.id;
            return (
              <div key={c.id} className="action-card" role="button" tabIndex={0}
                onClick={() => setSelectedCircuit(c.id)}
                style={isSelected ? selectedStyle : undefined}>
                <div className="action-icon">
                  <svg viewBox="0 0 24 24" className="icon" aria-hidden="true">
                    <path d="M4 12a8 8 0 1 1 16 0v3a3 3 0 0 1-3 3h-2a1 1 0 1 1 0-2h2a1 1 0 0 0 1-1v-3a6 6 0 1 0-12 0v3a1 1 0 0 0 1 1h2a1 1 0 1 1 0 2H7a3 3 0 0 1-3-3v-3z" fill="currentColor" />
                    <circle cx="12" cy="12" r="2.25" fill="currentColor" />
                  </svg>
                </div>
                <h4 className="action-title">{c.name}</h4>
                <p className="action-desc">Lunghezza ~ {(c.lengthMeters || 0).toFixed(0)} m • Punti {c.points || 0}</p>
              </div>
            );
          })}
        </div>
      </section>

      {/* Device liberi */}
      <section style={{ marginBottom: 28 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
          <h3 className="section-title" style={{ margin: 0 }}>Device attivi</h3>
          <span className="chip readonly" style={{ background: 'rgba(192,255,3,0.15)', borderColor: 'rgba(192,255,3,0.55)' }}>
            {activeMacs.length}
          </span>
          <span className="muted">in tempo reale via WebSocket</span>
        </div>

        {activeMacs.length === 0 ? (
          <div className="dz">
            <div className="dz-inner">
              <span className="dz-label">Nessun device GPS attivo</span>
              <span className="dz-hint">Avvia il simulatore o connetti dispositivi GPS</span>
            </div>
          </div>
        ) : (
          <div className="pilots-grid">
            {activeMacs.map(mac => {
              const assignedPilotId = deviceAssignments[mac] ?? '';
              const assignedPilot = pilots.find(p => String(p.id) === assignedPilotId);
              const pilotPhotoUrl = assignedPilot?.photoDriverUrl ? `${API_BASE}${assignedPilot.photoDriverUrl}` : null;
              const teamLogoUrl = assignedPilot?.photoTeamUrl ? `${API_BASE}${assignedPilot.photoTeamUrl}` : null;

              return (
                <div key={mac} className="pilot-card" style={{ ...(assignedPilotId ? selectedStyle : {}), gridTemplateColumns: '140px 1fr' }}>
                  <div className="pilot-photos col">
                    <div className="photo tall media-box">
                      {pilotPhotoUrl ? <img src={pilotPhotoUrl} alt={`${assignedPilot?.name} ${assignedPilot?.surname}`} className="pilot-photo-img" /> :
                        <div className="photo-placeholder"><div style={{ fontWeight: 700, color: 'var(--brand)' }}>Seleziona pilota</div><div className="muted" style={{ marginTop: 6 }}>Foto pilota</div></div>}
                    </div>
                    <div className="photo small media-box team-logo-box">
                      {teamLogoUrl ? <img src={teamLogoUrl} alt={assignedPilot?.team} className="team-logo-img" /> :
                        <div className="photo-placeholder"><div className="muted">Logo team</div></div>}
                    </div>
                  </div>

                  <div className="pilot-info wide">
                    <div className="pilot-name big">Assegnazione pilota</div>
                    <div className="pilot-team big muted" style={{ marginBottom: 12 }}>{mac}</div>
                    <div className="form-row" style={{ gridTemplateColumns: '1fr' }}>
                      <div className="form-col">
                        <label className="muted">Pilota</label>
                        <select className="input" value={assignedPilotId} onChange={(e) => setDeviceAssignments(prev => ({ ...prev, [mac]: e.target.value }))}>
                          <option value="">-- Seleziona --</option>
                          {pilots.map(p => <option key={p.id} value={String(p.id)}>{p.name} {p.surname} ({p.team})</option>)}
                        </select>
                      </div>
                    </div>
                    {assignedPilot ? (
                      <div style={{ marginTop: 12, display: 'flex', justifyContent: 'flex-end' }}>
                        <button className="btn-danger" onClick={() => setDeviceAssignments(prev => ({ ...prev, [mac]: '' }))}>Rimuovi</button>
                      </div>
                    ) : <span className="muted">non assegnato</span>}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Giri */}
      <section style={{ marginBottom: 28 }}>
        <h3 className="section-title">Numero giri</h3>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12 }}>
          <button className="btn-ghost" onClick={() => setTotalLaps(Math.max(1, totalLaps - 1))}>−</button>
          <div className="pilot-form" style={{ padding: 12, minWidth: 160 }}>
            <div style={{ textAlign: 'center' }}>
              <div className="muted" style={{ marginBottom: 6 }}>Giri</div>
              <div style={{ fontWeight: 900, fontSize: '1.8rem', color: 'var(--brand)' }}>{totalLaps}</div>
            </div>
          </div>
          <button className="btn-ghost" onClick={() => setTotalLaps(totalLaps + 1)}>+</button>
        </div>
      </section>

      {/* CTA */}
      <div className="cta-wrapper" style={{ marginTop: 10 }}>
        <button className="big-cta" onClick={handleStart} aria-label="Avvia/Mostra gara">START RACE</button>
        <p className="cta-hint">
          {selectedCircuit && Object.values(deviceAssignments).filter(Boolean).length > 0
            ? `${Object.values(deviceAssignments).filter(Boolean).length} ${Object.values(deviceAssignments).filter(Boolean).length === 1 ? 'pilota' : 'piloti'} × ${totalLaps} giri • circuito #${selectedCircuit}`
            : 'Se la gara è già in corso potrai visualizzarla subito.'}
        </p>
      </div>
    </div>
  );
}
