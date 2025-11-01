// src/pages/RaceLive.jsx
import React, { useState, useEffect, useRef, useMemo } from 'react';
import '../App.css';

const API_BASE = process.env.REACT_APP_API_BASE || `http://${window.location.hostname}:5000`;
const WS_URL = process.env.REACT_APP_WS_URL || `ws://${window.location.hostname}:5001`;

function toRad(d) { return d * Math.PI / 180; }
function haversine(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lat2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
const formatLap = (s) => {
  if (!s && s !== 0) return '—';
  const m = Math.floor(s / 60);
  const sec = (s % 60).toFixed(3);
  return `${m}:${sec.padStart(6, '0')}`;
};

// 🎨 palette ben distinta (12 colori)
const PALETTE = [
  '#C0FF03', '#2ED8A7', '#6AA9FF', '#FF7A59',
  '#B085FF', '#FFD166', '#EF476F', '#06D6A0',
  '#118AB2', '#FFE66D', '#F78C6B', '#8AC926'
];
// hash deterministico -> indice palette
function colorForKey(key) {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  return PALETTE[h % PALETTE.length];
}

export default function RaceLive({ raceConfig, onStopRace }) {
  const { circuitData, totalLaps } = raceConfig;

  const [snapshot, setSnapshot] = useState(null);
  const [blink, setBlink] = useState(true);
  const [penTargetMac, setPenTargetMac] = useState('');

  useEffect(() => { const t = setInterval(() => setBlink(b => !b), 700); return () => clearInterval(t); }, []);

  // 🧵 trail con fade temporale (più lungo)
  const trailsRef = useRef({}); // mac -> [{lat,lon,ts}]
  const TRAIL_MAX_AGE_MS = 30000; // 30s
  const TRAIL_MAX_LEN = 140;      // coda più lunga

  // mappa colori per coerenza
  const colorsRef = useRef({}); // mac -> color

  const canvasRef = useRef(null);
  const animFrameRef = useRef(null);
  const zoomRef = useRef(1);
  const panRef = useRef({ x: 0, y: 0 });
  const isDraggingRef = useRef(false);
  const lastMouseRef = useRef({ x: 0, y: 0 });

  // WebSocket: riceviamo snapshot server-side
  useEffect(() => {
    const ws = new WebSocket(WS_URL);
    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data?.type === 'race_snapshot') {
          const now = Date.now();

          // assegna colore per ogni mac (se non esiste)
          (data.drivers || []).forEach(d => {
            if (!colorsRef.current[d.mac]) colorsRef.current[d.mac] = colorForKey(d.mac + (d.team || '') + (d.tag || ''));
          });

          // aggiorna trail
          (data.drivers || []).forEach(d => {
            const key = d.mac;
            const trail = trailsRef.current[key] || [];
            const next = [...trail, { lat: d.lat, lon: d.lon, ts: now }].slice(-TRAIL_MAX_LEN);
            trailsRef.current[key] = next;
          });

          setSnapshot(data);
        } else if (data?.type === 'race_inactive') {
          setSnapshot(null);
        }
      } catch { }
    };
    ws.onerror = (e) => console.error('[RaceLive] WS error', e);
    return () => { try { ws.close(); } catch { } };
  }, []);

  // Canvas rendering (identico, ma scie + colori per pilota)
  useEffect(() => {
    if (!circuitData || !canvasRef.current) return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;

    const ensureSize = () => {
      const container = canvas.parentElement;
      const w = container.clientWidth || 600;
      const h = container.clientHeight || 520;
      if (canvas.width !== Math.floor(w * dpr) || canvas.height !== Math.floor(h * dpr)) {
        canvas.width = Math.floor(w * dpr);
        canvas.height = Math.floor(h * dpr);
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      }
    };
    const onResize = () => ensureSize();
    ensureSize();
    window.addEventListener('resize', onResize);

    const wheel = (e) => { e.preventDefault(); zoomRef.current = Math.max(0.5, Math.min(5, zoomRef.current * (e.deltaY > 0 ? 0.9 : 1.1))); };
    const mousedown = (e) => { isDraggingRef.current = true; lastMouseRef.current = { x: e.clientX, y: e.clientY }; canvas.style.cursor = 'grabbing'; };
    const mousemove = (e) => {
      if (!isDraggingRef.current) return;
      const dx = e.clientX - lastMouseRef.current.x;
      const dy = e.clientY - lastMouseRef.current.y;
      panRef.current.x += dx; panRef.current.y += dy;
      lastMouseRef.current = { x: e.clientX, y: e.clientY };
    };
    const mouseup = () => { isDraggingRef.current = false; canvas.style.cursor = 'grab'; };

    canvas.addEventListener('wheel', wheel, { passive: false });
    canvas.addEventListener('mousedown', mousedown);
    canvas.addEventListener('mousemove', mousemove);
    canvas.addEventListener('mouseup', mouseup);
    canvas.addEventListener('mouseleave', mouseup);
    canvas.style.cursor = 'grab';

    const lats = circuitData.sectors.map(s => s.lat);
    const lons = circuitData.sectors.map(s => s.lon);
    const minLat = Math.min(...lats), maxLat = Math.max(...lats);
    const minLon = Math.min(...lons), maxLon = Math.max(...lons);
    const centerLat = (minLat + maxLat) / 2;
    const centerLon = (minLon + maxLon) / 2;
    const R = 6371000;
    const centerLatRad = centerLat * Math.PI / 180;
    const dxList = lons.map(l => (l - centerLon) * Math.PI / 180 * R * Math.cos(centerLatRad));
    const dyList = lats.map(l => (l - centerLat) * Math.PI / 180 * R);
    const maxDx = Math.max(...dxList.map(Math.abs));
    const maxDy = Math.max(...dyList.map(Math.abs));
    const padding = 40;

    const project = (lat, lon) => {
      const w = canvas.width / dpr;
      const h = canvas.height / dpr;
      const maxRange = Math.max(maxDx, maxDy) * 1.1;
      const scale = Math.min(w - padding * 2, h - padding * 2) / (maxRange * 2) * zoomRef.current;
      const dx = (lon - centerLon) * Math.PI / 180 * R * Math.cos(centerLatRad);
      const dy = (lat - centerLat) * Math.PI / 180 * R;
      const x = w / 2 + dx * scale + panRef.current.x;
      const y = h / 2 - dy * scale + panRef.current.y;
      return { x, y, scale };
    };

    const draw = () => {
      ensureSize();
      const w = canvas.width / dpr;
      const h = canvas.height / dpr;
      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = '#0a0a0a';
      ctx.fillRect(0, 0, w, h);

      const widthMeters = circuitData.params?.widthMeters ?? 6;
      const pts = circuitData.sectors.map(s => project(s.lat, s.lon));
      const scale = pts[0]?.scale || 1;
      const trackPx = Math.max(6, widthMeters * scale);

      // bordo + asfalto
      ctx.strokeStyle = 'rgba(255,255,255,0.10)';
      ctx.lineWidth = trackPx + 4;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.beginPath(); pts.forEach((p, i) => i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)); ctx.closePath(); ctx.stroke();

      ctx.strokeStyle = 'rgba(80, 84, 90, 0.95)';
      ctx.lineWidth = trackPx;
      ctx.beginPath(); pts.forEach((p, i) => i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)); ctx.closePath(); ctx.stroke();

      // start line
      if (pts.length > 1) {
        const s0 = pts[0], s1 = pts[1];
        const ang = Math.atan2(s1.y - s0.y, s1.x - s0.x);
        ctx.save(); ctx.translate(s0.x, s0.y); ctx.rotate(ang);
        ctx.strokeStyle = '#ffffff'; ctx.lineWidth = Math.max(2, trackPx * 0.12);
        ctx.beginPath(); ctx.moveTo(0, -trackPx * 0.5); ctx.lineTo(0, trackPx * 0.5); ctx.stroke();
        ctx.restore();
      }

      // Trails & drivers
      const now = Date.now();
      Object.keys(trailsRef.current).forEach(key => {
        trailsRef.current[key] = (trailsRef.current[key] || []).filter(p => now - p.ts <= TRAIL_MAX_AGE_MS).slice(-TRAIL_MAX_LEN);
      });

      const drivers = snapshot?.drivers || [];
      const sorted = [...drivers].sort((a, b) => a.position - b.position);

      sorted.forEach((d, i) => {
        const color = colorsRef.current[d.mac] || '#C0FF03';

        // trail color personalizzato
        const trail = trailsRef.current[d.mac] || [];
        if (trail.length > 1) {
          for (let t = 1; t < trail.length; t++) {
            const prev = project(trail[t - 1].lat, trail[t - 1].lon);
            const cur = project(trail[t].lat, trail[t].lon);
            const ageFrac = Math.min(1, (now - trail[t].ts) / TRAIL_MAX_AGE_MS);
            const alpha = 0.75 * (1 - ageFrac);
            if (alpha > 0.02) {
              ctx.strokeStyle = color.replace('1)', `${alpha})`).replace('#', ''); // fallback sotto
              // se è esadecimale, non possiamo cambiare alpha -> uso rgba via funzione:
              // quindi converto in RGBA veloce:
              const useRGBA = (() => {
                if (color.startsWith('#')) {
                  const hex = color.replace('#', '');
                  const bigint = parseInt(hex.length === 3 ? hex.split('').map(c => c + c).join('') : hex, 16);
                  const r = (bigint >> 16) & 255;
                  const g = (bigint >> 8) & 255;
                  const b = bigint & 255;
                  return `rgba(${r},${g},${b},${alpha})`;
                }
                return color;
              })();
              ctx.strokeStyle = useRGBA;
              ctx.lineWidth = Math.max(2, trackPx * 0.12);
              ctx.beginPath();
              ctx.moveTo(prev.x, prev.y);
              ctx.lineTo(cur.x, cur.y);
              ctx.stroke();
            }
          }
        }

        // dot pilota con colore unico
        const p = project(d.lat, d.lon);
        const isLeader = i === 0;
        const r = Math.max(5, trackPx * 0.18) + (isLeader ? 1 : 0);
        ctx.shadowColor = 'rgba(0,0,0,0.5)'; ctx.shadowBlur = 4;
        // fill
        let fill = color;
        if (fill.startsWith('#')) {
          const hex = fill.replace('#', '');
          const bigint = parseInt(hex.length === 3 ? hex.split('').map(c => c + c).join('') : hex, 16);
          const rr = (bigint >> 16) & 255, gg = (bigint >> 8) & 255, bb = bigint & 255;
          fill = `rgba(${rr},${gg},${bb},1)`;
        }
        ctx.fillStyle = fill;
        ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2); ctx.fill();
        ctx.shadowBlur = 0; ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.stroke();

        ctx.fillStyle = '#fff'; ctx.font = 'bold 10px Roboto, sans-serif'; ctx.textAlign = 'center';
        ctx.fillText(d.tag, p.x, p.y - (r + 8));
      });

      animFrameRef.current = requestAnimationFrame(draw);
    };
    draw();

    return () => {
      window.removeEventListener('resize', onResize);
      canvas.removeEventListener('wheel', wheel);
      canvas.removeEventListener('mousedown', mousedown);
      canvas.removeEventListener('mousemove', mousemove);
      canvas.removeEventListener('mouseup', mouseup);
      canvas.removeEventListener('mouseleave', mouseup);
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    };
  }, [circuitData, snapshot]);

  const leaderboard = useMemo(() => {
    if (!snapshot?.drivers) return [];
    return [...snapshot.drivers].sort((a, b) => a.position - b.position);
  }, [snapshot]);

  const globalBestLap = snapshot?.globalBestLap || null;

  const statusColors = useMemo(() => {
    const s = snapshot?.raceStatus || 'IN CORSO';
    switch (s) {
      case 'RED FLAG': return { chipBg: 'rgba(225,6,0,.15)', chipBorder: '#e10600', chipText: '#ffdede', lbBorder: '#e10600' };
      case 'YELLOW FLAG': return { chipBg: 'rgba(241,196,15,.15)', chipBorder: '#f1c40f', chipText: '#fff3c4', lbBorder: '#f1c40f' };
      case 'FINITA': return { chipBg: 'rgba(154,163,154,.15)', chipBorder: '#9aa39a', chipText: '#e0e0e0', lbBorder: '#9aa39a' };
      case 'IN CORSO':
      default: return { chipBg: 'rgba(21,193,48,.15)', chipBorder: '#15c130', chipText: '#e9ffe0', lbBorder: null };
    }
  }, [snapshot?.raceStatus]);

  const sendStatus = async (status) => {
    try {
      await fetch(`${API_BASE}/api/race/status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status })
      });
    } catch (e) { console.error(e); }
  };
  const sendPenalty = async (type) => {
    if (!penTargetMac) return;
    try {
      await fetch(`${API_BASE}/api/race/penalty`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mac: penTargetMac, type })
      });
    } catch (e) { console.error(e); }
  };

  return (
    <div className="main small-top">
      {/* Top bar */}
      <div className="rs-live-topbar">
        <div className="rs-live-left">
          <span className="chip readonly" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span aria-hidden style={{
              width: 10, height: 10, borderRadius: '50%',
              background: '#ff4d4f', boxShadow: '0 0 12px rgba(255,77,79,.8)',
              opacity: blink ? 1 : .25, transition: 'opacity .15s linear'
            }} />
            LIVE
          </span>
          <span className="chip readonly">{snapshot?.totalLaps ?? totalLaps} giri</span>
          <span className="chip readonly" style={{
            background: statusColors.chipBg, border: `1px solid ${statusColors.chipBorder}`,
            color: statusColors.chipText, fontWeight: 800
          }}>
            {snapshot?.raceStatus || 'IN CORSO'}
          </span>
        </div>
        <div className="rs-live-right">
          <span className="chip readonly">{circuitData?.name || snapshot?.circuit?.name || 'Circuito'}</span>
          {(circuitData?.stats?.lengthMeters || snapshot?.circuit?.stats?.lengthMeters) &&
            <span className="chip readonly">{(circuitData?.stats?.lengthMeters || snapshot?.circuit?.stats?.lengthMeters).toFixed(0)} m</span>}
          {(circuitData?.params?.widthMeters || snapshot?.circuit?.params?.widthMeters) &&
            <span className="chip readonly">{(circuitData?.params?.widthMeters || snapshot?.circuit?.params?.widthMeters)} m larghezza</span>}
        </div>
      </div>

      {/* Griglia principale */}
      <div className="rs-live-grid">
        <div className="track-card">
          <canvas ref={canvasRef} className="track-canvas" />
        </div>

        <div
          className="leaderboard-card"
          style={{
            borderColor: statusColors.lbBorder ?? 'var(--line)',
            boxShadow: statusColors.lbBorder
              ? `0 8px 32px ${statusColors.lbBorder}33, inset 0 0 0 1px ${statusColors.lbBorder}55`
              : undefined
          }}
        >
          <div className="lb-header">
            <div className="lb-title">CLASSIFICA</div>
            <div className="lb-sub">{leaderboard.length} piloti</div>
          </div>

          <div className="lb-list">
            {leaderboard.length === 0 ? (
              <div className="no-drivers">
                <p>Nessun dato GPS ancora disponibile…</p>
                <small className="muted">Appena arrivano i pacchetti la classifica si popola</small>
              </div>
            ) : (
              leaderboard.map((d, idx) => {
                const isLeader = idx === 0;
                const fastest = d.bestLapTime && globalBestLap && d.bestLapTime === globalBestLap;
                return (
                  <div key={d.mac} className={`lb-row ${isLeader ? 'lb-leader' : ''}`} title={d.fullName}>
                    <div className="lb-pos">{idx + 1}</div>
                    <div className="lb-team">
                      {d.photoTeamUrl ? (
                        <img src={`${API_BASE}${d.photoTeamUrl}`} alt={d.team} className="lb-team-logo" />
                      ) : (
                        <div className="lb-team-color" style={{ background: colorsRef.current[d.mac] || '#C0FF03' }} />
                      )}
                    </div>
                    <div className="lb-name">{d.tag}</div>
                    <div className="lb-gap">{d.gapToLeader || (isLeader ? 'LEADER' : '')}</div>
                    <div className="lb-icons">
                      {fastest && <span className="lb-icon purple" title={`Best lap ${formatLap(d.bestLapTime)}`}>⏱</span>}
                    </div>
                    <div className="lb-lap"><span className="muted">Lap</span>&nbsp;{d.lapCount}/{snapshot?.totalLaps ?? totalLaps}</div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>

      {/* ======= CLASSIFICA FULL-WIDTH ======= */}
      <div className="leaderboard-card" style={{ marginTop: 12, width: '100%' }}>
        <div className="lb-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
          <div className="lb-title">CLASSIFICA DETTAGLIATA</div>
          <div className="lb-sub">{leaderboard.length} piloti • tempi ultimo giro e miglior giro</div>
        </div>

        <div className="lb-list">
          {leaderboard.map((d, idx) => {
            const fastest = d.bestLapTime && globalBestLap && d.bestLapTime === globalBestLap;
            return (
              <div key={`wide-${d.mac}`} className="lb-row" style={{ gridTemplateColumns: '28px 28px 1fr 90px 110px 110px 140px 90px' }} title={d.fullName}>
                <div className="lb-pos">{idx + 1}</div>
                <div className="lb-team">
                  {d.photoTeamUrl ? (
                    <img src={`${API_BASE}${d.photoTeamUrl}`} alt={d.team} className="lb-team-logo" />
                  ) : (
                    <div className="lb-team-color" style={{ background: colorsRef.current[d.mac] || '#C0FF03' }} />
                  )}
                </div>
                <div className="lb-name">{d.tag}</div>
                <div className="lb-gap" style={{ textAlign: 'right' }}>{idx === 0 ? 'LEADER' : d.gapToLeader}</div>
                <div className="lb-gap" title="Ultimo giro" style={{ fontWeight: 700, color: '#e9ffe0' }}>{formatLap(d.lastLapTime)}</div>
                <div className="lb-gap" title="Miglior giro" style={{ fontWeight: 700, color: fastest ? '#b085ff' : '#e9ffe0' }}>
                  {formatLap(d.bestLapTime)}{fastest && <span className="lb-icon purple" style={{ marginLeft: 6 }}>⏱</span>}
                </div>
                <div className="lb-gap" title="Penalità assegnate" style={{ fontWeight: 800 }}>{d?.penalty?.summary || '—'}</div>
                <div className="lb-lap" style={{ textAlign: 'right' }}><span className="muted">Lap</span>&nbsp;{d.lapCount}/{snapshot?.totalLaps ?? totalLaps}</div>
              </div>
            );
          })}
        </div>
      </div>

      {/* ======= COMANDI GARA (client → server) ======= */}
      <div className="leaderboard-card" style={{ marginTop: 12, width: '100%' }}>
        <div className="lb-header">
          <div className="lb-title">COMANDI GARA</div>
        </div>

        <div className="race-controls" style={{ justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', padding: '20px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span className="muted">Stato:</span>
            {['IN CORSO', 'FINITA', 'RED FLAG', 'YELLOW FLAG'].map(s => (
              <button
                key={s}
                className="btn-ghost"
                onClick={() => sendStatus(s)}
                style={{
                  borderColor: (snapshot?.raceStatus === s) ? 'rgba(192,255,3,0.6)' : 'var(--line)',
                  boxShadow: (snapshot?.raceStatus === s) ? '0 0 0 2px rgba(192,255,3,0.12) inset' : 'none',
                  fontWeight: 700
                }}
              >
                {s}
              </button>
            ))}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginTop: '15px' }}>
            <span className="muted">Sanzioni:</span>
            <select className="input" value={penTargetMac} onChange={(e) => setPenTargetMac(e.target.value)} style={{ width: 260 }}>
              <option value="">-- Seleziona pilota --</option>
              {leaderboard.map(d => (<option key={d.mac} value={d.mac}>{d.tag} — {d.fullName}</option>))}
            </select>

            {['+5s', '+10s', '+15s', '1mo avv. squalifica', 'squalifica'].map(k => (
              <button key={k} className="btn-ghost" disabled={!penTargetMac} onClick={() => sendPenalty(k)} style={{ fontWeight: 800 }}>
                {k}
              </button>
            ))}

            {penTargetMac && (
              <span className="muted" style={{ marginLeft: 6 }}>
                Attuale: <b>{leaderboard.find(d => d.mac === penTargetMac)?.penalty?.summary || '—'}</b>
              </span>
            )}
          </div>

          <button style={{ marginTop: '20px' }} className="btn-danger" onClick={async () => {
            try { await fetch(`${API_BASE}/api/race/stop`, { method: 'POST' }); } catch { }
            onStopRace();
          }}>Termina gara</button>
        </div>
      </div>
    </div>
  );
}
