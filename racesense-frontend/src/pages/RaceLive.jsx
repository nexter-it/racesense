import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import '../App.css';

const API_BASE = process.env.REACT_APP_API_BASE || `http://${window.location.hostname}:5000`;
const WS_URL = process.env.REACT_APP_WS_URL || `ws://${window.location.hostname}:5001`;

/* ---------------- Utils ---------------- */

function haversine(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const toRad = d => d * Math.PI / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
function findClosestSector(lat, lon, sectors) {
  let minDist = Infinity, closestIdx = 0;
  for (let i = 0; i < sectors.length; i++) {
    const s = sectors[i];
    const d = haversine(lat, lon, s.lat, s.lon);
    if (d < minDist) { minDist = d; closestIdx = i; }
  }
  return closestIdx;
}
function surnameTag(pilot) {
  const last = (pilot?.surname || '').trim().toUpperCase();
  return last.slice(0, 4) || 'PIL';
}
const formatLap = (s) => {
  if (!s) return '—';
  const m = Math.floor(s / 60);
  const sec = (s % 60).toFixed(3);
  return `${m}:${sec.padStart(6, '0')}`;
};

/* ---------------- Component ---------------- */

export default function RaceLive({ raceConfig, onStopRace }) {
  const { circuitData, totalLaps, assignments, pilots } = raceConfig;

  const [driversState, setDriversState] = useState({});
  const [leaderboard, setLeaderboard] = useState([]);
  const [activeBattles, setActiveBattles] = useState([]);
  const [overtakingPairs, setOvertakingPairs] = useState([]);

  // Stato gara (mini-dashboard)
  const [raceStatus, setRaceStatus] = useState('IN CORSO');

  // Sanzioni
  // penalties[mac] = { timeSec: number, warnings: number, dq: boolean, entries:[{type, value, ts}] }
  const [penalties, setPenalties] = useState({});
  const [penTargetMac, setPenTargetMac] = useState('');

  // refs per canvas/dati
  const canvasRef = useRef(null);
  const animFrameRef = useRef(null);
  const driversRef = useRef({});
  const zoomRef = useRef(1);
  const panRef = useRef({ x: 0, y: 0 });
  const isDraggingRef = useRef(false);
  const lastMouseRef = useRef({ x: 0, y: 0 });
  const lastPositionsRef = useRef({});

  // Blink dot per LIVE
  const [blink, setBlink] = useState(true);
  useEffect(() => {
    const t = setInterval(() => setBlink(b => !b), 700);
    return () => clearInterval(t);
  }, []);

  // mantieni ref aggiornato
  useEffect(() => { driversRef.current = driversState; }, [driversState]);

  /* ========== WebSocket GPS ========== */
  useEffect(() => {
    const ws = new WebSocket(WS_URL);
    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.mac && data.lat && data.lon) {
          const mac = String(data.mac);
          if (!assignments[mac]) return;
          handleGPSUpdate({
            mac,
            lat: Number(data.lat),
            lon: Number(data.lon),
            speed: Number(data.speedKmh || 0),
            ts: data.ts || Date.now(),
          });
        }
      } catch { }
    };
    ws.onerror = (e) => console.error('[RaceLive] WS error', e);
    return () => { try { ws.close(); } catch { } };
  }, [assignments]); // eslint-disable-line

  /* ========== Colore Team (fallback) ========== */
  const getTeamColor = useCallback((pilot, allPilots) => {
    if (pilot.color) return pilot.color;
    const teamPilots = allPilots.filter(p => p.team === pilot.team);
    const pilotIndex = teamPilots.findIndex(p => p.id === pilot.id);
    const teamHash = (pilot.team || 'TEAM').split('').reduce((acc, ch) => acc + ch.charCodeAt(0), 0);
    const hue = (teamHash * 137.508) % 360;
    if (teamPilots.length > 1) {
      const l = 50 + (pilotIndex * 8);
      const s = 75 - (pilotIndex * 5);
      return `hsl(${hue}, ${s}%, ${l}%)`;
    }
    return `hsl(${hue}, 75%, 55%)`;
  }, []);

  /* ========== GPS → Stato pilota ========== */
  const handleGPSUpdate = useCallback((gps) => {
    if (!circuitData?.sectors) return;

    const { mac, lat, lon, speed } = gps;
    const sectorIdx = findClosestSector(lat, lon, circuitData.sectors);
    const totalSectors = circuitData.sectors.length;

    const pilotId = assignments[mac];
    const pilot = pilots.find(p => String(p.id) === String(pilotId));
    if (!pilot) return;

    setDriversState(prev => {
      const existing = prev[mac] || {
        mac,
        pilotId,
        pilot,
        tag: surnameTag(pilot),
        fullName: `${pilot.name || ''} ${pilot.surname || ''}`.trim(),
        team: pilot.team,
        color: getTeamColor(pilot, pilots),
        photoTeamUrl: pilot.photoTeamUrl,
        lat, lon, speed: 0,
        sectorIdx,
        lastSectorIdx: sectorIdx,
        lapCount: 0,
        lapStartTime: Date.now(),
        lastLapTime: null,
        bestLapTime: null,
        pit: false,
        out: false,
        trail: []
      };

      // giro completato
      let lapCount = existing.lapCount;
      let lastLapTime = existing.lastLapTime;
      let bestLapTime = existing.bestLapTime;
      let lapStartTime = existing.lapStartTime;

      if (existing.lastSectorIdx > totalSectors - 10 && sectorIdx < 10) {
        const lapSec = (Date.now() - existing.lapStartTime) / 1000;
        if (lapSec > 5) {
          lapCount = existing.lapCount + 1;
          lastLapTime = lapSec;
          bestLapTime = !bestLapTime || lapSec < bestLapTime ? lapSec : bestLapTime;
          lapStartTime = Date.now();
        }
      }

      const trailLength = speed > 30 ? 40 : speed > 15 ? 25 : 15;
      const trail = [...existing.trail, { lat, lon }].slice(-trailLength);

      return {
        ...prev,
        [mac]: {
          ...existing,
          lat, lon, speed, sectorIdx,
          lastSectorIdx: sectorIdx,
          lapCount, lastLapTime, bestLapTime, lapStartTime,
          trail,
          updatedAt: Date.now()
        }
      };
    });
  }, [circuitData, assignments, pilots, getTeamColor]);

  /* ========== Classifica / Sorpassi / Duelli ========== */
  useEffect(() => {
    const sorted = Object.values(driversState).sort((a, b) => {
      if (a.lapCount !== b.lapCount) return b.lapCount - a.lapCount;
      return b.sectorIdx - a.sectorIdx;
    });

    const newOvertakes = [];
    const currentPos = {};
    sorted.forEach((d, i) => {
      currentPos[d.mac] = i;
      const lastPos = lastPositionsRef.current[d.mac];
      if (lastPos !== undefined && i < lastPos) {
        const overtaken = sorted[i + 1];
        if (overtaken && lastPositionsRef.current[overtaken.mac] === i) {
          newOvertakes.push({ overtaker: d.mac, overtaken: overtaken.mac, timestamp: Date.now() });
        }
      }
    });
    if (newOvertakes.length) {
      setOvertakingPairs(prev => {
        const now = Date.now();
        const keep = prev.filter(p => now - p.timestamp < 1600);
        return [...keep, ...newOvertakes];
      });
      setTimeout(() => { lastPositionsRef.current = currentPos; }, 1600);
    } else {
      const now = Date.now();
      setOvertakingPairs(prev => prev.filter(p => now - p.timestamp < 1600));
      if (overtakingPairs.length === 0) lastPositionsRef.current = currentPos;
    }

    const battles = [];
    for (let i = 0; i < sorted.length - 1; i++) {
      const a = sorted[i], b = sorted[i + 1];
      if (a.lapCount !== b.lapCount) continue;
      const dist = haversine(a.lat, a.lon, b.lat, b.lon);
      const was = activeBattles.some(x =>
        (x.leader.mac === a.mac && x.chaser.mac === b.mac) ||
        (x.leader.mac === b.mac && x.chaser.mac === a.mac)
      );
      if (dist < 30 || (was && dist < 35)) {
        battles.push({ leader: a, chaser: b, distance: dist, position: i + 1 });
      }
    }
    setActiveBattles(battles);
    setLeaderboard(sorted);
  }, [driversState]); // eslint-disable-line

  const globalBestLap = useMemo(() => {
    let best = null;
    Object.values(driversState).forEach(d => {
      if (d.bestLapTime && (best === null || d.bestLapTime < best)) best = d.bestLapTime;
    });
    return best;
  }, [driversState]);

  /* ========== Canvas: inizializza UNA SOLA VOLTA per circuito ========== */
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

    // precompute projection params
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

      // bordo soft
      ctx.strokeStyle = 'rgba(255,255,255,0.10)';
      ctx.lineWidth = trackPx + 4;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.beginPath();
      pts.forEach((p, i) => i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y));
      ctx.closePath(); ctx.stroke();

      // asfalto
      ctx.strokeStyle = 'rgba(80, 84, 90, 0.95)';
      ctx.lineWidth = trackPx;
      ctx.beginPath();
      pts.forEach((p, i) => i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y));
      ctx.closePath(); ctx.stroke();

      // start
      if (pts.length > 1) {
        const s0 = pts[0], s1 = pts[1];
        const ang = Math.atan2(s1.y - s0.y, s1.x - s0.x);
        ctx.save(); ctx.translate(s0.x, s0.y); ctx.rotate(ang);
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = Math.max(2, trackPx * 0.12);
        ctx.beginPath(); ctx.moveTo(0, -trackPx * 0.5); ctx.lineTo(0, trackPx * 0.5); ctx.stroke();
        ctx.restore();
      }

      // piloti
      const sorted = Object.values(driversRef.current).sort((a, b) => {
        if (a.lapCount !== b.lapCount) return a.lapCount - b.lapCount;
        return a.sectorIdx - b.sectorIdx;
      });

      sorted.forEach((d, i) => {
        const p = project(d.lat, d.lon);

        if (d.trail?.length > 1) {
          ctx.strokeStyle = d.color;
          ctx.globalAlpha = 0.6;
          ctx.lineWidth = Math.max(2, trackPx * 0.12);
          ctx.beginPath();
          d.trail.forEach((t, ti) => {
            const tp = project(t.lat, t.lon);
            ti ? ctx.lineTo(tp.x, tp.y) : ctx.moveTo(tp.x, tp.y);
          });
          ctx.stroke(); ctx.globalAlpha = 1;
        }

        const isLeader = i === sorted.length - 1;
        const r = Math.max(5, trackPx * 0.18) + (isLeader ? 1 : 0);
        ctx.shadowColor = 'rgba(0,0,0,0.5)'; ctx.shadowBlur = 4;
        ctx.fillStyle = d.color; ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2); ctx.fill();
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
  }, [circuitData]); // solo al cambio circuito

  /* ---------- Helpers UI ---------- */

  const gapToLeader = (driver, leader) => {
    if (!leader || !driver) return '';
    if (driver.lapCount < leader.lapCount) return `+${leader.lapCount - driver.lapCount}L`;
    const sectorDiff = leader.sectorIdx - driver.sectorIdx;
    const est = Math.max(0, sectorDiff / 10);
    return `+${est.toFixed(2)}`;
  };

  // Colori stato (chip + bordo classifica laterale)
  const statusColors = useMemo(() => {
    switch (raceStatus) {
      case 'RED FLAG':
        return { chipBg: 'rgba(225,6,0,.15)', chipBorder: '#e10600', chipText: '#ffdede', lbBorder: '#e10600' };
      case 'YELLOW FLAG':
        return { chipBg: 'rgba(241,196,15,.15)', chipBorder: '#f1c40f', chipText: '#fff3c4', lbBorder: '#f1c40f' };
      case 'FINITA':
        return { chipBg: 'rgba(154,163,154,.15)', chipBorder: '#9aa39a', chipText: '#e0e0e0', lbBorder: '#9aa39a' };
      case 'IN CORSO':
      default:
        return { chipBg: 'rgba(21,193,48,.15)', chipBorder: '#15c130', chipText: '#e9ffe0', lbBorder: null };
    }
  }, [raceStatus]);

  // Gestione sanzioni
  const upsertPenalty = useCallback((mac, updater) => {
    setPenalties(prev => {
      const base = prev[mac] || { timeSec: 0, warnings: 0, dq: false, entries: [] };
      const updated = updater(base);
      return { ...prev, [mac]: updated };
    });
  }, []);

  const applyPenalty = (type) => {
    if (!penTargetMac) return;
    if (type === '+5s' || type === '+10s' || type === '+15s') {
      const add = parseInt(type.replace(/\D/g, ''), 10);
      upsertPenalty(penTargetMac, (p) => ({
        ...p,
        timeSec: p.timeSec + add,
        entries: [...p.entries, { type, value: add, ts: Date.now() }]
      }));
    } else if (type === '1mo avv. squalifica') {
      upsertPenalty(penTargetMac, (p) => ({
        ...p,
        warnings: p.warnings + 1,
        entries: [...p.entries, { type, value: 'WARN', ts: Date.now() }]
      }));
    } else if (type === 'squalifica') {
      upsertPenalty(penTargetMac, (p) => ({
        ...p,
        dq: true,
        entries: [...p.entries, { type, value: 'DQ', ts: Date.now() }]
      }));
    }
  };

  const penaltySummary = (mac) => {
    const p = penalties[mac];
    if (!p) return '—';
    const parts = [];
    if (p.timeSec) parts.push(`+${p.timeSec}s`);
    if (p.warnings) parts.push(`⚠️ x${p.warnings}`);
    if (p.dq) parts.push('DQ');
    return parts.join('  ');
  };

  /* ---------- Render ---------- */

  const topBattle = useMemo(() => {
    if (!activeBattles.length) return null;
    return activeBattles.slice().sort((a, b) => a.distance - b.distance)[0];
  }, [activeBattles]);

  return (
    <div className="main small-top">
      {/* Top bar */}
      <div className="rs-live-topbar">
        <div className="rs-live-left">
          <span className="chip readonly" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span
              aria-hidden
              style={{
                width: 10, height: 10, borderRadius: '50%',
                background: '#ff4d4f', boxShadow: '0 0 12px rgba(255,77,79,.8)',
                opacity: blink ? 1 : .25, transition: 'opacity .15s linear'
              }}
            />
            LIVE
          </span>
          <span className="chip readonly">{totalLaps} giri</span>

          {/* Chip STATO con colori dinamici */}
          <span
            className="chip readonly"
            style={{
              background: statusColors.chipBg,
              border: `1px solid ${statusColors.chipBorder}`,
              color: statusColors.chipText,
              fontWeight: 800
            }}
          >
            {raceStatus}
          </span>
        </div>
        <div className="rs-live-right">
          <span className="chip readonly">{circuitData?.name || 'Circuito'}</span>
          {circuitData?.stats?.lengthMeters && <span className="chip readonly">{circuitData.stats.lengthMeters.toFixed(0)} m</span>}
          {circuitData?.params?.widthMeters && <span className="chip readonly">{circuitData.params.widthMeters} m larghezza</span>}
        </div>
      </div>

      {/* Griglia principale */}
      <div className="rs-live-grid">
        <div className="track-card">
          <canvas ref={canvasRef} className="track-canvas" />
        </div>

        {/* Classifica laterale: bordo dinamico per stato */}
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

          {/* {topBattle && (
            <div className="lb-battle-overlay">
              <div className="battle-indicator">
                <div className="battle-line-left"></div>
                <div className="battle-content">
                  <div className="battle-label">DUELLO</div>
                  <div className="battle-gap">{topBattle.distance.toFixed(1)} m</div>
                </div>
                <div className="battle-line-right"></div>
              </div>
            </div>
          )} */}

          <div className="lb-list">
            {leaderboard.length === 0 ? (
              <div className="no-drivers">
                <p>Nessun dato GPS ancora disponibile…</p>
                <small className="muted">Appena arrivano i pacchetti la classifica si popola</small>
              </div>
            ) : (
              leaderboard.map((d, idx) => {
                const leader = leaderboard[0];
                const isLeader = idx === 0;
                const fastest = d.bestLapTime && globalBestLap && d.bestLapTime === globalBestLap;
                const isOvertaking = overtakingPairs.find(p => p.overtaker === d.mac);
                const isBeingOvertaken = overtakingPairs.find(p => p.overtaken === d.mac);

                return (
                  <div
                    key={d.mac}
                    className={`lb-row ${isLeader ? 'lb-leader' : ''} ${isOvertaking ? 'overtaking' : ''} ${isBeingOvertaken ? 'being-overtaken' : ''}`}
                    title={d.fullName}
                  >
                    <div className="lb-pos">{idx + 1}</div>

                    <div className="lb-team">
                      {d.photoTeamUrl ? (
                        <img src={`${API_BASE}${d.photoTeamUrl}`} alt={d.team} className="lb-team-logo" />
                      ) : (
                        <div className="lb-team-color" style={{ background: d.color }} />
                      )}
                    </div>

                    <div className="lb-name">{d.tag}</div>

                    <div className="lb-gap">{isLeader ? 'LEADER' : gapToLeader(d, leader)}</div>

                    <div className="lb-icons">
                      {fastest && <span className="lb-icon purple" title={`Best lap ${formatLap(d.bestLapTime)}`}>⏱</span>}
                      {d.pit && <span className="lb-icon" title="Pit">🅿️</span>}
                      {d.out && <span className="lb-icon" title="Out">⛔</span>}
                    </div>

                    <div className="lb-lap"><span className="muted">Lap</span>&nbsp;{d.lapCount}/{totalLaps}</div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>

      {/* ======= CLASSIFICA FULL-WIDTH ======= */}
      <div
        className="leaderboard-card"
        style={{ marginTop: 12, width: '100%' }}
      >
        <div className="lb-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
          <div className="lb-title">CLASSIFICA DETTAGLIATA</div>
          <div className="lb-sub">{leaderboard.length} piloti • tempi ultimo giro e miglior giro</div>
        </div>

        <div className="lb-list">
          {leaderboard.map((d, idx) => {
            const leader = leaderboard[0];
            const fastest = d.bestLapTime && globalBestLap && d.bestLapTime === globalBestLap;

            return (
              <div
                key={`wide-${d.mac}`}
                className="lb-row"
                style={{
                  gridTemplateColumns: '28px 28px 1fr 90px 110px 110px 140px 90px',
                }}
                title={d.fullName}
              >
                <div className="lb-pos">{idx + 1}</div>

                <div className="lb-team">
                  {d.photoTeamUrl ? (
                    <img src={`${API_BASE}${d.photoTeamUrl}`} alt={d.team} className="lb-team-logo" />
                  ) : (
                    <div className="lb-team-color" style={{ background: d.color }} />
                  )}
                </div>

                <div className="lb-name">{d.tag}</div>

                <div className="lb-gap" style={{ textAlign: 'right' }}>
                  {idx === 0 ? 'LEADER' : gapToLeader(d, leader)}
                </div>

                <div className="lb-gap" title="Ultimo giro" style={{ fontWeight: 700, color: '#e9ffe0' }}>
                  {formatLap(d.lastLapTime)}
                </div>

                <div className="lb-gap" title="Miglior giro" style={{ fontWeight: 700, color: fastest ? '#b085ff' : '#e9ffe0' }}>
                  {formatLap(d.bestLapTime)}
                  {fastest && <span className="lb-icon purple" style={{ marginLeft: 6 }}>⏱</span>}
                </div>

                {/* Penalità (somma e dettagli compatti) */}
                <div className="lb-gap" title="Penalità assegnate" style={{ fontWeight: 800 }}>
                  {penaltySummary(d.mac)}
                </div>

                <div className="lb-lap" style={{ textAlign: 'right' }}>
                  <span className="muted">Lap</span>&nbsp;{d.lapCount}/{totalLaps}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* ======= COMANDI GARA ======= */}
      <div className="leaderboard-card" style={{ marginTop: 12, width: '100%' }}>
        <div className="lb-header">
          <div className="lb-title">COMANDI GARA</div>
        </div>

        <div className="race-controls" style={{ justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', padding: '20px' }}>
          {/* Stato gara */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span className="muted">Stato:</span>
            {['IN CORSO', 'FINITA', 'RED FLAG', 'YELLOW FLAG'].map(s => (
              <button
                key={s}
                className="btn-ghost"
                onClick={() => setRaceStatus(s)}
                style={{
                  borderColor: raceStatus === s ? 'rgba(192,255,3,0.6)' : 'var(--line)',
                  boxShadow: raceStatus === s ? '0 0 0 2px rgba(192,255,3,0.12) inset' : 'none',
                  fontWeight: 700
                }}
              >
                {s}
              </button>
            ))}
          </div>

          {/* Sanzioni */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginTop: '15px' }}>
            <span className="muted">Sanzioni:</span>
            <select
              className="input"
              value={penTargetMac}
              onChange={(e) => setPenTargetMac(e.target.value)}
              style={{ width: 220 }}
            >
              <option value="">-- Seleziona pilota --</option>
              {leaderboard.map(d => (
                <option key={d.mac} value={d.mac}>{d.tag} — {d.fullName}</option>
              ))}
            </select>

            {['+5s', '+10s', '+15s', '1mo avv. squalifica', 'squalifica'].map(k => (
              <button
                key={k}
                className="btn-ghost"
                disabled={!penTargetMac}
                onClick={() => applyPenalty(k)}
                style={{ fontWeight: 800 }}
              >
                {k}
              </button>
            ))}

            {penTargetMac && (
              <span className="muted" style={{ marginLeft: 6 }}>
                Attuale: <b>{penaltySummary(penTargetMac)}</b>
              </span>
            )}
          </div>

          <button style={{ marginTop: '20px' }} className="btn-danger" onClick={onStopRace}>Termina gara</button>
        </div>
      </div>
    </div>
  );
}
