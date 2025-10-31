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

  // Device attivi e assegnazioni (pilotId SALVATO COME STRINGA)
  const [activeDevices, setActiveDevices] = useState({});
  const [deviceAssignments, setDeviceAssignments] = useState({});

  const wsRef = useRef(null);
  const deviceTimeoutRef = useRef({});

  // --- Carica circuiti e piloti ---
  useEffect(() => {
    fetch(`${API_BASE}/api/circuits`)
      .then(r => r.json())
      .then(setCircuits)
      .catch(e => console.error('Errore caricamento circuiti:', e));

    fetch(`${API_BASE}/api/pilots`)
      .then(r => r.json())
      .then(setPilots)
      .catch(e => console.error('Errore caricamento piloti:', e));
  }, []);

  // --- Dettagli circuito selezionato ---
  useEffect(() => {
    if (!selectedCircuit) return;
    fetch(`${API_BASE}/api/circuits/${selectedCircuit}`)
      .then(r => r.json())
      .then(setCircuitData)
      .catch(e => console.error('Errore caricamento circuito:', e));
  }, [selectedCircuit]);

  // --- WebSocket per device attivi ---
  useEffect(() => {
    const ws = new WebSocket(WS_URL);
    wsRef.current = ws;

    ws.onopen = () => console.log('[RaceSetup] WS connesso');
    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.mac && data.lat && data.lon) {
          const mac = String(data.mac);
          const lat = Number(data.lat);
          const lon = Number(data.lon);
          const speed = Number(data.speedKmh || 0);

          setActiveDevices(prev => ({
            ...prev,
            [mac]: { lastSeen: Date.now(), lat, lon, speed, data }
          }));

          if (deviceTimeoutRef.current[mac]) clearTimeout(deviceTimeoutRef.current[mac]);
          deviceTimeoutRef.current[mac] = setTimeout(() => {
            setActiveDevices(prev => {
              const copy = { ...prev };
              delete copy[mac];
              return copy;
            });
          }, 6000);
        }
      } catch (err) {
        console.error('Errore parsing GPS:', err);
      }
    };
    ws.onerror = (e) => console.error('[RaceSetup] WS errore', e);
    ws.onclose = () => console.log('[RaceSetup] WS chiuso');

    return () => {
      Object.values(deviceTimeoutRef.current).forEach(clearTimeout);
      ws.close();
    };
  }, []);

  // --- Assegna pilota: mantengo SEMPRE stringa ---
  const assignPilotToDevice = (mac, pilotIdString) => {
    setDeviceAssignments(prev => ({ ...prev, [mac]: pilotIdString }));
  };

  // --- Avvio gara ---
  const handleStart = () => {
    if (!selectedCircuit) return alert('ATTENZIONE: seleziona un circuito!');
    const assignedDevices = Object.keys(deviceAssignments).filter(mac => deviceAssignments[mac]);
    if (assignedDevices.length === 0) return alert('ATTENZIONE: assegna almeno un pilota a un device attivo!');

    const selectedPilotIds = Object.values(deviceAssignments).filter(Boolean); // stringhe
    const selectedPilots = pilots.filter(p => selectedPilotIds.includes(String(p.id)));

    const raceConfig = {
      circuit: selectedCircuit,
      circuitData,
      totalLaps,
      assignments: deviceAssignments, // { MAC: 'pilotId' }
      pilots: selectedPilots,
      activeDevices: assignedDevices
    };
    onStartRace(raceConfig);
  };

  const activeMacs = Object.keys(activeDevices);
  const assignedCount = Object.values(deviceAssignments).filter(Boolean).length;
  const canStart = Boolean(selectedCircuit) && assignedCount > 0;

  const selectedStyle = {
    borderColor: 'rgba(192, 255, 3, 0.55)',
    boxShadow: '0 0 24px rgba(192,255,3,0.25)'
  };

  return (
    <div className="main small-top">
      <h2 className="section-title" style={{ marginBottom: 8 }}>Configurazione Gara</h2>
      <p className="subtitle" style={{ marginTop: 0, marginBottom: 24 }}>
        Seleziona il circuito, assegna i piloti ai device e imposta i giri.
      </p>

      {/* Circuito */}
      <section style={{ marginBottom: 28 }}>
        <h3 className="section-title">Circuito</h3>
        <div className="actions" style={{ marginBottom: 16 }}>
          {circuits.map(c => {
            const isSelected = selectedCircuit === c.id;
            return (
              <div
                key={c.id}
                className="action-card"
                role="button"
                tabIndex={0}
                onClick={() => setSelectedCircuit(c.id)}
                style={isSelected ? selectedStyle : undefined}
              >
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

        {/* {circuitData && (
          <div className="pilot-form" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 12 }}>
            <div>
              <div className="muted">Lunghezza</div>
              <div><strong>{circuitData.stats?.lengthMeters?.toFixed(0) ?? '—'} m</strong></div>
            </div>
            <div>
              <div className="muted">Settori</div>
              <div><strong>{circuitData.sectors?.length ?? 0}</strong></div>
            </div>
            <div>
              <div className="muted">Larghezza</div>
              <div><strong>{circuitData.params?.widthMeters ?? 6} m</strong></div>
            </div>
          </div>
        )} */}
      </section>

      {/* Device & Assegnazioni */}
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
          <div className="pilots-grid">{/* 3 colonne su desktop */}
            {activeMacs.map(mac => {
              const device = activeDevices[mac];
              const assignedPilotId = deviceAssignments[mac] ?? '';
              const assignedPilot = pilots.find(p => String(p.id) === assignedPilotId);

              const pilotPhotoUrl = assignedPilot?.photoDriverUrl ? `${API_BASE}${assignedPilot.photoDriverUrl}` : null;
              const teamLogoUrl = assignedPilot?.photoTeamUrl ? `${API_BASE}${assignedPilot.photoTeamUrl}` : null;

              return (
                <div
                  key={mac}
                  className="pilot-card"
                  style={{
                    ...(assignedPilotId ? selectedStyle : {}),
                    gridTemplateColumns: '140px 1fr' // 2 colonne: immagini + contenuto
                  }}
                >
                  {/* Colonna sinistra: foto pilota (tall) + logo team (small) */}
                  <div className="pilot-photos col">
                    <div className="photo tall media-box">
                      {pilotPhotoUrl ? (
                        <img src={pilotPhotoUrl} alt={`${assignedPilot.name} ${assignedPilot.surname}`} className="pilot-photo-img" />
                      ) : (
                        <div className="photo-placeholder">
                          <div style={{ fontWeight: 700, color: 'var(--brand)' }}>Seleziona pilota</div>
                          <div className="muted" style={{ marginTop: 6 }}>Foto pilota</div>
                        </div>
                      )}
                    </div>

                    <div className="photo small media-box team-logo-box">
                      {teamLogoUrl ? (
                        <img src={teamLogoUrl} alt={assignedPilot.team} className="team-logo-img" />
                      ) : (
                        <div className="photo-placeholder">
                          <div className="muted">Logo team</div>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Colonna destra: info e selezione */}
                  <div className="pilot-info wide">
                    <div className="pilot-name big">Assegnazione pilota</div>

                    {/* Mostra il MAC al posto della frase lunga */}
                    <div className="pilot-team big muted" style={{ marginBottom: 12 }}>
                       {mac}
                    </div>

                    <div className="form-row" style={{ gridTemplateColumns: '1fr' }}>
                      <div className="form-col">
                        <label className="muted">Pilota</label>
                        <select
                          className="input"
                          value={assignedPilotId}
                          onChange={(e) => assignPilotToDevice(mac, e.target.value)}
                        >
                          <option value="">-- Seleziona --</option>
                          {pilots.map(p => (
                            <option key={p.id} value={String(p.id)}>
                              {p.name} {p.surname} ({p.team})
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>

                    {/* Dati selezionati: SOLO team */}
                    {assignedPilot && (
                      <div className="pilot-chips" style={{ marginTop: 10 }}>
                        <span className="chip readonly" title="Team">{assignedPilot.team}</span>
                      </div>
                    )}

                    {/* Zona azioni in basso: se assegnato -> Rimuovi, altrimenti "non assegnato" */}
                    <div style={{ marginTop: 12, display: 'flex', justifyContent: 'flex-end' }}>
                      {assignedPilot ? (
                        <button
                          className="btn-danger"
                          onClick={() => assignPilotToDevice(mac, '')}
                          title="Rimuovi assegnazione"
                        >
                          Rimuovi
                        </button>
                      ) : (
                        <span className="muted">non assegnato</span>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Numero giri */}
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

      {/* CTA Avvio */}
      <div className="cta-wrapper" style={{ marginTop: 10 }}>
        <button className="big-cta" disabled={!canStart} onClick={handleStart} aria-label="Avvia gara">
          START RACE
        </button>
        <p className="cta-hint">
          {canStart
            ? `${assignedCount} ${assignedCount === 1 ? 'pilota' : 'piloti'} × ${totalLaps} giri` +
              (selectedCircuit ? ` • circuito #${selectedCircuit}` : '')
            : 'Seleziona circuito e assegna almeno un pilota a un device'}
        </p>
      </div>
    </div>
  );
}
