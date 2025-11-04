// src/pages/RaceLive.jsx
import React, { useState, useEffect, useRef, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import '../App.css';
import { colorFromName } from '../utils/colors'; // se non l'hai già, te lo ho dato nel messaggio precedente

const API_BASE = process.env.REACT_APP_API_BASE || `http://${window.location.hostname}:5000`;
const WS_URL = process.env.REACT_APP_WS_URL || `ws://${window.location.hostname}:5001`;

function toRad(d) { return d * Math.PI / 180; }

const formatLap = (s) => {
  if (!s && s !== 0) return '—';
  const m = Math.floor(s / 60);
  const sec = (s % 60).toFixed(3);
  return `${m}:${sec.padStart(6, '0')}`;
};

function haversine(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export default function RaceLive({ raceConfig, onStopRace }) {
  const { circuitData, totalLaps } = raceConfig;
  const navigate = useNavigate();

  const [snapshot, setSnapshot] = useState(null);
  const [initCircuit, setInitCircuit] = useState(null);
  const [blink, setBlink] = useState(true);
  const [penTargetMac, setPenTargetMac] = useState('');
  useEffect(() => { const t = setInterval(() => setBlink(b => !b), 700); return () => clearInterval(t); }, []);

  // ---- trails + colori
  const trailsRef = useRef({});
  const TRAIL_MAX_AGE_MS = 2000;   // prima 18000
  const TRAIL_MAX_LEN = 15;        // prima 90
  const TRAIL_MIN_MOVE_M = 2.5;    // non aggiungere punti se si è mossi < 2.5 m
  const colorsRef = useRef({});

  // ---- canvas & interazione
  const canvasRef = useRef(null);
  const animFrameRef = useRef(null);
  const zoomRef = useRef(1);
  const panRef = useRef({ x: 0, y: 0 });
  const isDraggingRef = useRef(false);
  const lastMouseRef = useRef({ x: 0, y: 0 });

  const dirtyRef = useRef(false);
  const lastDrawRef = useRef(0);

  // pointer events (pinch/pan)
  const pointersRef = useRef(new Map());
  const pinchStartRef = useRef({ dist: 0, zoom: 1 });

  // ---- websocket
  useEffect(() => {
    const ws = new WebSocket(WS_URL);
    ws.onmessage = async (event) => {
      try {
        const data = JSON.parse(event.data);

        if (data?.type === 'race_init') {
          setInitCircuit(data.circuit || null);
          setSnapshot(s => s ? { ...s, totalLaps: data.totalLaps, raceStatus: data.raceStatus } : s);
          return;
        }

        if (data?.type === 'race_snapshot') {
          const now = Date.now();

          (data.drivers || []).forEach(d => {
            const keyName = d.fullName || d.tag || d.mac;
            if (!colorsRef.current[d.mac]) {
              colorsRef.current[d.mac] = colorFromName(keyName);
            }
          });

          (data.drivers || []).forEach(d => {
            const t = trailsRef.current[d.mac] || [];
            const last = t[t.length - 1];
            // Aggiungi un punto solo se ci si è mossi abbastanza (TRAIL_MIN_MOVE_M)
            if (!last || haversine(last.lat, last.lon, d.lat, d.lon) >= TRAIL_MIN_MOVE_M) {
              const next = [...t, { lat: d.lat, lon: d.lon, ts: now }];
              trailsRef.current[d.mac] = next.length > TRAIL_MAX_LEN ? next.slice(-TRAIL_MAX_LEN) : next;
            }
          });

          if (!initCircuit?.sectors?.length && data.circuit?.id) {
            try {
              const rc = await fetch(`${API_BASE}/api/circuits/${data.circuit.id}`);
              if (rc.ok) {
                const full = await rc.json();
                setInitCircuit({ id: data.circuit.id, name: full.name || data.circuit.id, stats: full.stats || {}, params: full.params || {}, sectors: full.sectors || [] });
              }
            } catch { /* no-op */ }
          }

          setSnapshot(data);
          dirtyRef.current = true;
        } else if (data?.type === 'race_inactive') {
          setSnapshot(null);
        }
      } catch { }
    };
    ws.onerror = (e) => console.error('[RaceLive] WS error', e);
    return () => { try { ws.close(); } catch { } };
  }, [initCircuit?.sectors?.length]);

  // === Colori per S1/S2/S3 presi dai customSectors del circuito ===
  const sectorColors = useMemo(() => {
    const circuit = circuitData || initCircuit || snapshot?.circuit || {};
    const custom = circuit?.customSectors || [];
    const fallback = ['#ff4d4f', '#2ecc71', '#3498db']; // rosso, verde, blu
    return [0, 1, 2].map(i => custom[i]?.color || fallback[i]);
  }, [circuitData, initCircuit, snapshot?.circuit]);

  // ---- draw
  useEffect(() => {
    const circuit = circuitData || initCircuit;
    if (!circuit || !canvasRef.current || !circuit?.sectors?.length) return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d', { alpha: false });
    const dpr = window.devicePixelRatio || 1;

    // importantissimo per mobile (evita lo scroll durante il pinch)
    canvas.style.touchAction = 'none';

    const ensureSize = () => {
      const w = canvas.parentElement.clientWidth || 600;
      const h = canvas.parentElement.clientHeight || 520;
      if (canvas.width !== Math.floor(w * dpr) || canvas.height !== Math.floor(h * dpr)) {
        canvas.width = Math.floor(w * dpr); canvas.height = Math.floor(h * dpr);
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      }
    };
    const onResize = () => ensureSize();
    ensureSize();
    window.addEventListener('resize', onResize);

    // ---- helpers proiezione
    const lats = circuit.sectors.map(s => s.lat);
    const lons = circuit.sectors.map(s => s.lon);
    const minLat = Math.min(...lats), maxLat = Math.max(...lats);
    const minLon = Math.min(...lons), maxLon = Math.max(...lons);
    const centerLat = (minLat + maxLat) / 2, centerLon = (minLon + maxLon) / 2;
    const R = 6371000, centerLatRad = centerLat * Math.PI / 180;
    const dxList = lons.map(l => (l - centerLon) * Math.PI / 180 * R * Math.cos(centerLatRad));
    const dyList = lats.map(l => (l - centerLat) * Math.PI / 180 * R);
    const maxDx = Math.max(...dxList.map(Math.abs));
    const maxDy = Math.max(...dyList.map(Math.abs));
    const padding = 40;

    const project = (lat, lon) => {
      const w = canvas.width / dpr, h = canvas.height / dpr;
      const maxRange = Math.max(maxDx, maxDy) * 1.1;
      const scale = Math.min(w - padding * 2, h - padding * 2) / (maxRange * 2) * zoomRef.current;
      const dx = (lon - centerLon) * Math.PI / 180 * R * Math.cos(centerLatRad);
      const dy = (lat - centerLat) * Math.PI / 180 * R;
      return { x: w / 2 + dx * scale + panRef.current.x, y: h / 2 - dy * scale + panRef.current.y, scale };
    };

    // ---- interazione mouse
    const wheel = (e) => {
      e.preventDefault();
      const dir = e.deltaY > 0 ? 0.9 : 1.1;
      zoomRef.current = Math.max(0.5, Math.min(6, zoomRef.current * dir));
    };
    const mousedown = (e) => { isDraggingRef.current = true; lastMouseRef.current = { x: e.clientX, y: e.clientY }; canvas.style.cursor = 'grabbing'; };
    const mousemove = (e) => { if (!isDraggingRef.current) return; panRef.current.x += e.clientX - lastMouseRef.current.x; panRef.current.y += e.clientY - lastMouseRef.current.y; lastMouseRef.current = { x: e.clientX, y: e.clientY }; };
    const mouseup = () => { isDraggingRef.current = false; canvas.style.cursor = 'grab'; };
    canvas.addEventListener('wheel', wheel, { passive: false });
    canvas.addEventListener('mousedown', mousedown);
    canvas.addEventListener('mousemove', mousemove);
    canvas.addEventListener('mouseup', mouseup);
    canvas.addEventListener('mouseleave', mouseup);
    canvas.style.cursor = 'grab';

    // ---- interazione touch (pointer events)
    const onPointerDown = (ev) => {
      canvas.setPointerCapture?.(ev.pointerId);
      pointersRef.current.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
      if (pointersRef.current.size === 1) {
        lastMouseRef.current = { x: ev.clientX, y: ev.clientY };
      } else if (pointersRef.current.size === 2) {
        const pts = Array.from(pointersRef.current.values());
        const dx = pts[0].x - pts[1].x;
        const dy = pts[0].y - pts[1].y;
        pinchStartRef.current = { dist: Math.hypot(dx, dy), zoom: zoomRef.current };
      }
    };
    const onPointerMove = (ev) => {
      if (!pointersRef.current.has(ev.pointerId)) return;
      pointersRef.current.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });

      if (pointersRef.current.size === 1) {
        const p = pointersRef.current.get(ev.pointerId);
        panRef.current.x += p.x - lastMouseRef.current.x;
        panRef.current.y += p.y - lastMouseRef.current.y;
        lastMouseRef.current = { ...p };
      } else if (pointersRef.current.size === 2) {
        const pts = Array.from(pointersRef.current.values());
        const dx = pts[0].x - pts[1].x;
        const dy = pts[0].y - pts[1].y;
        const dist = Math.hypot(dx, dy);
        if (pinchStartRef.current.dist > 0) {
          const ratio = dist / pinchStartRef.current.dist;
          zoomRef.current = Math.max(0.5, Math.min(6, pinchStartRef.current.zoom * ratio));
        }
      }
      ev.preventDefault();
    };
    const onPointerUp = (ev) => {
      canvas.releasePointerCapture?.(ev.pointerId);
      pointersRef.current.delete(ev.pointerId);
      if (pointersRef.current.size < 2) {
        pinchStartRef.current.dist = 0;
      }
    };
    canvas.addEventListener('pointerdown', onPointerDown, { passive: false });
    canvas.addEventListener('pointermove', onPointerMove, { passive: false });
    canvas.addEventListener('pointerup', onPointerUp);
    canvas.addEventListener('pointercancel', onPointerUp);
    canvas.addEventListener('pointerleave', onPointerUp);

    // ---- render
    const draw = () => {
      // evita ridisegni continui: solo quando dirty e al massimo 30 fps
      const noww = performance.now();
      if (!dirtyRef.current && noww - lastDrawRef.current < 33) return;

      dirtyRef.current = false;
      lastDrawRef.current = noww;

      ensureSize();
      const w = canvas.width / dpr, h = canvas.height / dpr;

      // full clear + bg
      ctx.fillStyle = '#0a0a0a';
      ctx.fillRect(0, 0, w, h);

      const widthMeters = circuit.params?.widthMeters ?? 6;
      const pts = circuit.sectors.map(s => project(s.lat, s.lon));
      const scale = pts[0]?.scale || 1;
      const trackPx = Math.max(6, widthMeters * scale);

      // bordo + asfalto
      // === BORDO ESTERNO COLORATO PER SETTORI ===
      const sectors = circuit.customSectors || circuitData?.customSectors || initCircuit?.customSectors || [];

      if (Array.isArray(sectors) && sectors.length > 0) {
        // Disegna bordo per ciascun settore col suo colore
        sectors.forEach((sector, idx) => {
          if (sector.startIdx == null || sector.endIdx == null) return;
          const start = Math.max(0, Math.min(sector.startIdx, circuit.sectors.length - 1));
          const end = Math.max(0, Math.min(sector.endIdx, circuit.sectors.length - 1));
          if (end <= start) return;

          const color = sector.color || ['#ff0000', '#00ff00', '#0000ff'][idx % 3];
          ctx.save();
          ctx.lineCap = 'round';
          ctx.lineJoin = 'round';
          ctx.strokeStyle = color;
          ctx.lineWidth = trackPx + 3;           // spessore bordo esterno
          ctx.globalAlpha = 0.65;                // stessa trasparenza dell’editor

          ctx.beginPath();
          for (let i = start; i <= end; i++) {
            const p = project(circuit.sectors[i].lat, circuit.sectors[i].lon);
            if (i === start) ctx.moveTo(p.x, p.y);
            else ctx.lineTo(p.x, p.y);
          }
          ctx.stroke();
          ctx.restore();
        });
      } else {
        // fallback: bordo grigio uniforme
        ctx.strokeStyle = 'rgba(255,255,255,0.10)';
        ctx.lineWidth = trackPx + 3;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.beginPath();
        pts.forEach((p, i) => i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y));
        ctx.closePath();
        ctx.stroke();
      }

      // asfalto (uguale)
      ctx.strokeStyle = 'rgba(80,84,90,0.95)';
      ctx.lineWidth = trackPx;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.beginPath();
      pts.forEach((p, i) => i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y));
      ctx.closePath();
      ctx.stroke();

      // linea start
      if (pts.length > 1) {
        const s0 = pts[0], s1 = pts[1]; const ang = Math.atan2(s1.y - s0.y, s1.x - s0.x);
        ctx.save(); ctx.translate(s0.x, s0.y); ctx.rotate(ang);
        ctx.strokeStyle = '#ffffff'; ctx.lineWidth = Math.max(2, trackPx * 0.12);
        ctx.beginPath(); ctx.moveTo(0, -trackPx * 0.5); ctx.lineTo(0, trackPx * 0.5); ctx.stroke(); ctx.restore();
      }

      // trails clean
      const now = Date.now();
      Object.keys(trailsRef.current).forEach(k => {
        trailsRef.current[k] = (trailsRef.current[k] || []).filter(p => now - p.ts <= TRAIL_MAX_AGE_MS).slice(-TRAIL_MAX_LEN);
      });

      const drivers = snapshot?.drivers || [];
      const sorted = [...drivers].sort((a, b) => a.position - b.position);

      sorted.forEach((d, i) => {
        const color = colorsRef.current[d.mac] || colorFromName(d.fullName || d.tag || d.mac);
        const trail = trailsRef.current[d.mac] || [];
        if (trail.length > 1) {
          for (let t = 1; t < trail.length; t++) {
            const prev = project(trail[t - 1].lat, trail[t - 1].lon);
            const cur = project(trail[t].lat, trail[t].lon);
            const ageFrac = Math.min(1, (now - trail[t].ts) / TRAIL_MAX_AGE_MS);
            const alpha = 0.75 * (1 - ageFrac);
            let rgba = color;
            if (color.startsWith('#')) {
              const hex = color.slice(1);
              const full = hex.length === 3 ? hex.split('').map(c => c + c).join('') : hex;
              const v = parseInt(full, 16), r = (v >> 16) & 255, g = (v >> 8) & 255, b = v & 255;
              rgba = `rgba(${r},${g},${b},${alpha})`;
            }
            ctx.strokeStyle = rgba; ctx.lineWidth = Math.max(2, trackPx * 0.12);
            ctx.beginPath(); ctx.moveTo(prev.x, prev.y); ctx.lineTo(cur.x, cur.y); ctx.stroke();
          }
        }
        const p = project(d.lat, d.lon);
        const r = Math.max(5, trackPx * 0.18) + (i === 0 ? 1 : 0);
        let fill = color;
        if (fill.startsWith('#')) {
          const hex = fill.slice(1); const full = hex.length === 3 ? hex.split('').map(c => c + c).join('') : hex;
          const v = parseInt(full, 16), rr = (v >> 16) & 255, gg = (v >> 8) & 255, bb = v & 255;
          fill = `rgba(${rr},${gg},${bb},1)`;
        }
        ctx.shadowColor = 'rgba(0,0,0,0.35)';
        ctx.shadowBlur = 2;
        ctx.fillStyle = fill; ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2); ctx.fill();
        ctx.shadowBlur = 0; ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.stroke();
        ctx.fillStyle = '#fff'; ctx.font = 'bold 10px Roboto, sans-serif'; ctx.textAlign = 'center';
        ctx.fillText(d.tag, p.x, p.y - (r + 8));
      });

      // animFrameRef.current = requestAnimationFrame(draw);
    };

    draw();
    const interval = setInterval(() => { dirtyRef.current = true; draw(); }, 250);

    return () => {
      window.removeEventListener('resize', onResize);
      canvas.removeEventListener('wheel', wheel);
      canvas.removeEventListener('mousedown', mousedown);
      canvas.removeEventListener('mousemove', mousemove);
      canvas.removeEventListener('mouseup', mouseup);
      canvas.removeEventListener('mouseleave', mouseup);
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerup', onPointerUp);
      canvas.removeEventListener('pointercancel', onPointerUp);
      canvas.removeEventListener('pointerleave', onPointerUp);
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
      clearInterval(interval);
    };
  }, [circuitData, initCircuit, snapshot]);

  const leaderboard = useMemo(() => (!snapshot?.drivers) ? [] : [...snapshot.drivers].sort((a, b) => a.position - b.position), [snapshot]);
  const globalBestLap = snapshot?.globalBestLap || null;

  // chip di stato (no border)
  const statusChipStyle = useMemo(() => {
    const s = snapshot?.raceStatus || 'IN CORSO';
    switch (s) {
      case 'RED FLAG': return { background: 'rgba(225,6,0,.22)', color: '#ffdede' };
      case 'YELLOW FLAG': return { background: 'rgba(241,196,15,.22)', color: '#fff3c4' };
      case 'FINITA': return { background: 'rgba(154,163,154,.22)', color: '#f0f0f0' };
      default: return { background: 'rgba(21,193,48,.22)', color: '#dfffe9' };
    }
  }, [snapshot?.raceStatus]);

  const sendStatus = async (status) => {
    try { await fetch(`${API_BASE}/api/race/status`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status }) }); }
    catch (e) { console.error(e); }
  };
  const sendPenalty = async (type) => {
    if (!penTargetMac) return;
    try { await fetch(`${API_BASE}/api/race/penalty`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mac: penTargetMac, type }) }); }
    catch (e) { console.error(e); }
  };

  const circuitName = (circuitData?.name || initCircuit?.name || snapshot?.circuit?.name || 'Circuito');
  const circuitStatsLen = (circuitData?.stats?.lengthMeters ?? initCircuit?.stats?.lengthMeters ?? snapshot?.circuit?.stats?.lengthMeters);
  const circuitWidth = (circuitData?.params?.widthMeters ?? initCircuit?.params?.widthMeters ?? snapshot?.circuit?.params?.widthMeters);

  return (
    <div className="main small-top">
      {/* TOP BAR — senza bordi, scroll orizzontale su mobile */}
      <div
        className="rs-live-topbar rs-live-topbar--glass"
      >
        <div className="rs-chip-row">
          <span className="chip readonly live-pill">
            <span aria-hidden className={`live-dot ${blink ? 'on' : 'off'}`} /> LIVE
          </span>
          <span className="chip readonly pill">{snapshot?.totalLaps ?? totalLaps} giri</span>
          <span className="chip readonly pill" style={{ ...statusChipStyle, fontWeight: 900 }}>{snapshot?.raceStatus || 'IN CORSO'}</span>
          <span className="chip readonly pill">{circuitName}</span>
          {circuitStatsLen && (<span className="chip readonly pill">{(+circuitStatsLen).toFixed(0)} m</span>)}
          {circuitWidth && (<span className="chip readonly pill">{circuitWidth} m larghezza</span>)}
        </div>
      </div>

      <div className="rs-live-grid">
        <div className="track-card"><canvas ref={canvasRef} className="track-canvas" /></div>

        <div className="leaderboard-card">
          <div className="lb-header"><div className="lb-title">CLASSIFICA</div><div className="lb-sub">{leaderboard.length} piloti</div></div>

          <div className="lb-list">
            {leaderboard.length === 0 ? (
              <div className="no-drivers"><p>Nessun dato GPS ancora disponibile…</p><small className="muted">Appena arrivano i pacchetti la classifica si popola</small></div>
            ) : (
              leaderboard.map((d, idx) => {
                const isLeader = idx === 0;
                const fastest = d.bestLapTime && globalBestLap && d.bestLapTime === globalBestLap;
                return (
                  <div
                    key={d.mac}
                    className={`lb-row ${isLeader ? 'lb-leader' : ''}`}
                    title={`${d.fullName} — Clicca per seguire`}
                    role="button"
                    tabIndex={0}
                    onClick={() => navigate(`/pilot/${d.mac}`)}
                    onKeyDown={(e) => { if (e.key === 'Enter') navigate(`/pilot/${d.mac}`); }}
                    style={{ cursor: 'pointer' }}
                  >
                    <div className="lb-pos">{idx + 1}</div>
                    <div className="lb-team">
                      {d.photoTeamUrl ? (
                        <img src={`${API_BASE}${d.photoTeamUrl}`} alt={d.team} className="lb-team-logo" />
                      ) : (
                        <div className="lb-team-color" style={{ background: colorsRef.current[d.mac] || colorFromName(d.fullName || d.tag || d.mac) }} />
                      )}
                    </div>
                    <div className="lb-name">{d.tag}</div>
                    <div className="lb-gap">{d.gapToLeader || (isLeader ? 'LEADER' : '')}</div>
                    <div className="lb-icons">{fastest && <span className="lb-icon purple" title={`Best lap ${formatLap(d.bestLapTime)}`}>⏱</span>}</div>
                    <div className="lb-lap"><span className="muted">Lap</span>&nbsp;{d.lapCount}/{snapshot?.totalLaps ?? totalLaps}</div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>

      {/* Dettagliata */}
      <div className="leaderboard-card" style={{ marginTop: 12, width: '100%' }}>
        <div className="lb-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
          <div className="lb-title">CLASSIFICA DETTAGLIATA</div>
          <div className="lb-sub">{leaderboard.length} piloti • tempi ultimo giro e miglior giro</div>
        </div>

        {/* === INTESTAZIONE COLONNE CLASSIFICA DETTAGLIATA === */}
        <div
          className="lb-row"
          style={{
            gridTemplateColumns:
              '28px 28px 1fr 90px 90px 90px 90px 110px 110px 140px 90px',
            fontWeight: 800,
            background: 'rgba(255,255,255,0.05)',
            borderBottom: '1px solid rgba(255,255,255,0.1)',
            color: 'rgba(206, 206, 206, 0.72)',
            marginLeft: '10px',
            marginRight: '10px',
            marginTop: '15px',
          }}
        >
          <div>P</div>
          <div>Team</div>
          <div>Pilota</div>
          <div style={{ textAlign: 'right' }}>GAP</div>
          <div style={{ textAlign: 'right', color: sectorColors[0], fontWeight: 900 }}>S1</div>
          <div style={{ textAlign: 'right', color: sectorColors[1], fontWeight: 900 }}>S2</div>
          <div style={{ textAlign: 'right', color: sectorColors[2], fontWeight: 900 }}>S3</div>
          <div style={{ textAlign: 'right' }}>Ultimo</div>
          <div style={{ textAlign: 'right' }}>Migliore</div>
          <div style={{ textAlign: 'right' }}>Sanzioni</div>
          <div style={{ textAlign: 'right' }}>Giri</div>
        </div>

        <div className="lb-list">
          {leaderboard.map((d, idx) => {
            const fastest = d.bestLapTime && globalBestLap && d.bestLapTime === globalBestLap;
            return (
              <div
                key={`wide-${d.mac}`}
                className="lb-row"
                style={{
                  gridTemplateColumns:
                    '28px 28px 1fr 90px 90px 90px 90px 110px 110px 140px 90px',
                  cursor: 'pointer',
                }}
                title={`${d.fullName} — Clicca per seguire`}
                onClick={() => navigate(`/pilot/${d.mac}`)}
              >
                <div className="lb-pos">{idx + 1}</div>
                <div className="lb-team">
                  {d.photoTeamUrl ? (
                    <img src={`${API_BASE}${d.photoTeamUrl}`} alt={d.team} className="lb-team-logo" />
                  ) : (
                    <div
                      className="lb-team-color"
                      style={{
                        background:
                          colorsRef.current[d.mac] ||
                          colorFromName(d.fullName || d.tag || d.mac),
                      }}
                    />
                  )}
                </div>
                <div className="lb-name">{d.tag}</div>

                {/* GAP */}
                <div className="lb-gap" style={{ textAlign: 'right' }}>
                  {idx === 0 ? 'LEADER' : d.gapToLeader}
                </div>

                {/* === TEMPI SETTORI DAL SERVER === */}
                <div className="lb-gap" title="Settore 1" style={{ color: '#fff' }}>
                  {formatLap(d.lastSectorTimes?.S1 ?? d.sectorTimes?.S1)}
                </div>
                <div className="lb-gap" title="Settore 2" style={{ color: '#fff' }}>
                  {formatLap(d.lastSectorTimes?.S2 ?? d.sectorTimes?.S2)}
                </div>
                <div className="lb-gap" title="Settore 3" style={{ color: '#fff' }}>
                  {formatLap(d.lastSectorTimes?.S3 ?? d.sectorTimes?.S3)}
                </div>

                {/* Ultimo giro */}
                <div
                  className="lb-gap"
                  title="Ultimo giro"
                  style={{ fontWeight: 700, color: '#e9ffe0' }}
                >
                  {formatLap(d.lastLapTime)}
                </div>

                {/* Miglior giro */}
                <div
                  className="lb-gap"
                  title="Miglior giro"
                  style={{
                    fontWeight: 700,
                    color: fastest ? '#b085ff' : '#e9ffe0',
                  }}
                >
                  {formatLap(d.bestLapTime)}
                  {fastest && (
                    <span className="lb-icon purple" style={{ marginLeft: 6 }}>
                      ⏱
                    </span>
                  )}
                </div>

                <div
                  className="lb-gap"
                  title="Penalità assegnate"
                  style={{ fontWeight: 800 }}
                >
                  {d?.penalty?.summary || '—'}
                </div>
                <div className="lb-lap" style={{ textAlign: 'right' }}>
                  <span className="muted">Lap</span>&nbsp;
                  {d.lapCount}/{snapshot?.totalLaps ?? totalLaps}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* COMANDI GARA */}
      <div className="leaderboard-card" style={{ marginTop: 12, width: '100%' }}>
        <div className="lb-header"><div className="lb-title">COMANDI GARA</div></div>
        <div className="race-controls" style={{ justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', padding: '20px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span className="muted">Stato:</span>
            {['IN CORSO', 'FINITA', 'RED FLAG', 'YELLOW FLAG'].map(s => (
              <button key={s} className="btn-ghost" onClick={() => sendStatus(s)} style={{ fontWeight: 700 }}>{s}</button>
            ))}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginTop: '15px' }}>
            <span className="muted">Sanzioni:</span>
            <select className="input" value={penTargetMac} onChange={(e) => setPenTargetMac(e.target.value)} style={{ width: 260 }}>
              <option value="">-- Seleziona pilota --</option>
              {leaderboard.map(d => (<option key={d.mac} value={d.mac}>{d.tag} — {d.fullName}</option>))}
            </select>
            {['+5s', '+10s', '+15s', '1mo avv. squalifica', 'squalifica'].map(k => (
              <button key={k} className="btn-ghost" disabled={!penTargetMac} onClick={() => sendPenalty(k)} style={{ fontWeight: 800 }}>{k}</button>
            ))}
            {penTargetMac && <span className="muted" style={{ marginLeft: 6 }}>Attuale: <b>{leaderboard.find(d => d.mac === penTargetMac)?.penalty?.summary || '—'}</b></span>}
          </div>

          <button style={{ marginTop: '20px' }} className="btn-danger" onClick={async () => { try { await fetch(`${API_BASE}/api/race/stop`, { method: 'POST' }) } catch { }; onStopRace(); }}>Termina gara</button>
        </div>
      </div>
    </div>
  );
}
