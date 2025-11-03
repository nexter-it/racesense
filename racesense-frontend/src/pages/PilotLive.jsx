// src/pages/PilotLive.jsx
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import '../App.css';
import { colorFromName } from '../utils/colors';

const API_BASE = process.env.REACT_APP_API_BASE || `http://${window.location.hostname}:5000`;
const WS_URL = process.env.REACT_APP_WS_URL || `ws://${window.location.hostname}:5001`;

const formatLap = (s) => {
    if (!s && s !== 0) return '—';
    const m = Math.floor(s / 60);
    const sec = (s % 60).toFixed(3);
    return `${m}:${sec.padStart(6, '0')}`;
};

export default function PilotLive() {
    const { mac } = useParams();
    const navigate = useNavigate();
    const [circuit, setCircuit] = useState(null);
    const [raceStatus, setRaceStatus] = useState('IN CORSO');
    const [totalLaps, setTotalLaps] = useState(0);
    const [driver, setDriver] = useState(null);

    const color = useMemo(() => colorFromName(driver?.fullName || driver?.tag || mac), [driver?.fullName, driver?.tag, mac]);

    // trail
    const trailsRef = useRef([]);
    const TRAIL_MAX_AGE_MS = 20000;
    const TRAIL_MAX_LEN = 110;

    // canvas & interazione
    const canvasRef = useRef(null);
    const animFrameRef = useRef(null);
    const zoomRef = useRef(1);
    const panRef = useRef({ x: 0, y: 0 });

    // pinch/pan
    const pointersRef = useRef(new Map());
    const pinchStartRef = useRef({ dist: 0, zoom: 1, last: { x: 0, y: 0 } });

    useEffect(() => {
        let cancelled = false;
        const load = async () => {
            try {
                const r = await fetch(`${API_BASE}/api/race/pilot/${mac}`);
                if (!r.ok) throw new Error('Pilota non trovato o gara non attiva');
                const j = await r.json();
                if (cancelled) return;

                setRaceStatus(j.raceStatus || 'IN CORSO');
                setTotalLaps(j.totalLaps || 0);
                setDriver(j.pilot || null);

                if (j.circuit?.sectors?.length) {
                    setCircuit(j.circuit);
                } else if (j.circuit?.id) {
                    try {
                        const rc = await fetch(`${API_BASE}/api/circuits/${j.circuit.id}`);
                        if (rc.ok) {
                            const full = await rc.json();
                            setCircuit({ id: j.circuit.id, name: full.name || j.circuit.id, stats: full.stats || {}, params: full.params || {}, sectors: full.sectors || [] });
                        } else {
                            setCircuit(j.circuit);
                        }
                    } catch {
                        setCircuit(j.circuit);
                    }
                } else {
                    setCircuit(null);
                }
            } catch (e) {
                console.error(e);
                setDriver(null);
                setCircuit(null);
            }
        };
        load();
        return () => { cancelled = true; };
    }, [mac]);

    useEffect(() => {
        const ws = new WebSocket(WS_URL);
        ws.onmessage = async (event) => {
            try {
                const data = JSON.parse(event.data);

                if (data?.type === 'race_init') {
                    if (data.circuit?.sectors?.length) setCircuit(data.circuit);
                    setRaceStatus(data.raceStatus || 'IN CORSO');
                    setTotalLaps(data.totalLaps || 0);
                    return;
                }

                if (data?.type === 'race_snapshot') {
                    setRaceStatus(data.raceStatus || 'IN CORSO');
                    setTotalLaps(data.totalLaps || 0);

                    if (!circuit?.sectors?.length && data.circuit?.id) {
                        try {
                            const rc = await fetch(`${API_BASE}/api/circuits/${data.circuit.id}`);
                            if (rc.ok) {
                                const full = await rc.json();
                                setCircuit({ id: data.circuit.id, name: full.name || data.circuit.id, stats: full.stats || {}, params: full.params || {}, sectors: full.sectors || [] });
                            } else {
                                setCircuit(data.circuit);
                            }
                        } catch {
                            setCircuit(data.circuit);
                        }
                    }

                    const d = (data.drivers || []).find(x => String(x.mac).toUpperCase() === String(mac).toUpperCase());
                    if (d) {
                        const now = Date.now();
                        const t = trailsRef.current || [];
                        trailsRef.current = [...t, { lat: d.lat, lon: d.lon, ts: now }].slice(-TRAIL_MAX_LEN);
                        setDriver(prev => ({ ...(d || {}), lapTimes: d.lapTimes ?? prev?.lapTimes ?? [] }));
                    }
                } else if (data?.type === 'race_inactive') {
                    setRaceStatus('FINITA');
                }
            } catch { }
        };
        ws.onerror = (e) => console.error('[PilotLive] WS error', e);
        return () => { try { ws.close(); } catch { } };
    }, [mac, circuit?.sectors?.length]);

    useEffect(() => {
        if (!circuit || !Array.isArray(circuit.sectors) || circuit.sectors.length === 0 || !canvasRef.current) return;

        const canvas = canvasRef.current;
        const ctx = canvas.getContext('2d', { alpha: false });
        const dpr = window.devicePixelRatio || 1;

        canvas.style.touchAction = 'none'; // important per iOS/Android

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

        // proiezione
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

        // wheel desktop
        const onWheel = (e) => {
            e.preventDefault();
            const dir = e.deltaY > 0 ? 0.9 : 1.1;
            zoomRef.current = Math.max(0.5, Math.min(6, zoomRef.current * dir));
        };
        canvas.addEventListener('wheel', onWheel, { passive: false });

        // pointer touch (pinch/pan)
        const onPointerDown = (ev) => {
            canvas.setPointerCapture?.(ev.pointerId);
            pointersRef.current.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
            if (pointersRef.current.size === 1) {
                pinchStartRef.current.last = { x: ev.clientX, y: ev.clientY };
            } else if (pointersRef.current.size === 2) {
                const pts = Array.from(pointersRef.current.values());
                const dx = pts[0].x - pts[1].x;
                const dy = pts[0].y - pts[1].y;
                pinchStartRef.current.dist = Math.hypot(dx, dy);
                pinchStartRef.current.zoom = zoomRef.current;
            }
        };
        const onPointerMove = (ev) => {
            if (!pointersRef.current.has(ev.pointerId)) return;
            pointersRef.current.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });

            if (pointersRef.current.size === 1) {
                const p = pointersRef.current.get(ev.pointerId);
                panRef.current.x += p.x - pinchStartRef.current.last.x;
                panRef.current.y += p.y - pinchStartRef.current.last.y;
                pinchStartRef.current.last = { ...p };
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

        // render
        const draw = () => {
            ensureSize();
            const w = canvas.width / dpr, h = canvas.height / dpr;

            ctx.fillStyle = '#0a0a0a';
            ctx.fillRect(0, 0, w, h);

            const widthMeters = circuit?.params?.widthMeters ?? 6;
            const pts = circuit.sectors.map(s => project(s.lat, s.lon));
            const scale = pts[0]?.scale || 1;
            const trackPx = Math.max(6, widthMeters * scale);

            // pista
            ctx.strokeStyle = 'rgba(255,255,255,0.10)'; ctx.lineWidth = trackPx + 4; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
            ctx.beginPath(); pts.forEach((p, i) => i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)); ctx.closePath(); ctx.stroke();
            ctx.strokeStyle = 'rgba(80,84,90,0.95)'; ctx.lineWidth = trackPx;
            ctx.beginPath(); pts.forEach((p, i) => i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)); ctx.closePath(); ctx.stroke();

            // start
            if (pts.length > 1) {
                const s0 = pts[0], s1 = pts[1]; const ang = Math.atan2(s1.y - s0.y, s1.x - s0.x);
                ctx.save(); ctx.translate(s0.x, s0.y); ctx.rotate(ang);
                ctx.strokeStyle = '#ffffff'; ctx.lineWidth = Math.max(2, trackPx * 0.12);
                ctx.beginPath(); ctx.moveTo(0, -trackPx * 0.5); ctx.lineTo(0, trackPx * 0.5); ctx.stroke(); ctx.restore();
            }

            // trail
            const now = Date.now();
            trailsRef.current = (trailsRef.current || []).filter(p => now - p.ts <= TRAIL_MAX_AGE_MS).slice(-TRAIL_MAX_LEN);
            const trail = trailsRef.current || [];
            if (trail.length > 1) {
                for (let t = 1; t < trail.length; t++) {
                    const prev = project(trail[t - 1].lat, trail[t - 1].lon);
                    const cur = project(trail[t].lat, trail[t].lon);
                    const ageFrac = Math.min(1, (now - trail[t].ts) / TRAIL_MAX_AGE_MS);
                    const alpha = 0.8 * (1 - ageFrac);
                    let rgba = color;
                    if (color.startsWith('#')) {
                        const hex = color.slice(1), full = hex.length === 3 ? hex.split('').map(c => c + c).join('') : hex;
                        const v = parseInt(full, 16), r = (v >> 16) & 255, g = (v >> 8) & 255, b = v & 255;
                        rgba = `rgba(${r},${g},${b},${alpha})`;
                    }
                    ctx.strokeStyle = rgba; ctx.lineWidth = Math.max(2, trackPx * 0.12);
                    ctx.beginPath(); ctx.moveTo(prev.x, prev.y); ctx.lineTo(cur.x, cur.y); ctx.stroke();
                }
            }

            // dot
            if (driver) {
                const p = project(driver.lat, driver.lon);
                const r = Math.max(6, trackPx * 0.2);
                let fill = color;
                if (fill.startsWith('#')) {
                    const hex = fill.slice(1), full = hex.length === 3 ? hex.split('').map(c => c + c).join('') : hex;
                    const v = parseInt(full, 16), rr = (v >> 16) & 255, gg = (v >> 8) & 255, bb = v & 255;
                    fill = `rgba(${rr},${gg},${bb},1)`;
                }
                ctx.shadowColor = 'rgba(0,0,0,0.5)'; ctx.shadowBlur = 4;
                ctx.fillStyle = fill; ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2); ctx.fill();
                ctx.shadowBlur = 0; ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.stroke();

                ctx.fillStyle = '#fff'; ctx.font = 'bold 11px Roboto, sans-serif'; ctx.textAlign = 'center';
                ctx.fillText(driver.tag || 'PIL', p.x, p.y - (r + 10));
            }

            animFrameRef.current = requestAnimationFrame(draw);
        };
        draw();

        return () => {
            window.removeEventListener('resize', onResize);
            canvas.removeEventListener('wheel', onWheel);
            canvas.removeEventListener('pointerdown', onPointerDown);
            canvas.removeEventListener('pointermove', onPointerMove);
            canvas.removeEventListener('pointerup', onPointerUp);
            canvas.removeEventListener('pointercancel', onPointerUp);
            canvas.removeEventListener('pointerleave', onPointerUp);
            if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
        };
    }, [circuit, driver, color]);

    return (
        <div className="main small-top">
            {/* TOP BAR — senza bordi + riga scrollabile */}
            <div className="rs-live-topbar rs-live-topbar--glass">
                <div className="rs-chip-row">
                    <span className="chip readonly pill">PILOTA</span>
                    <span className="chip readonly pill" style={{ fontWeight: 800 }}>{driver?.tag || mac}</span>
                    <span className="chip readonly pill">{driver?.fullName || '—'}</span>
                    <span className="chip readonly pill">{totalLaps} giri</span>
                    <span className="chip readonly pill" style={{ background: 'rgba(21,193,48,.22)', color: '#dfffe9', fontWeight: 900 }}>{raceStatus}</span>
                    <span className="chip readonly pill">{circuit?.name || circuit?.id || 'Circuito'}</span>
                    {circuit?.stats?.lengthMeters && <span className="chip readonly pill">{circuit.stats.lengthMeters.toFixed(0)} m</span>}
                    {circuit?.params?.widthMeters && <span className="chip readonly pill">{circuit.params.widthMeters} m larghezza</span>}
                    <button className="btn-ghost" onClick={() => navigate('/race')} style={{ whiteSpace: 'nowrap' }}>⬅ Torna alla gara</button>
                </div>
            </div>

            <div className="rs-live-grid" style={{ gridTemplateColumns: '1fr 420px' }}>
                <div className="track-card">
                    {!circuit?.sectors?.length && (
                        <div style={{ position: 'absolute', inset: 0, display: 'grid', placeitems: 'center', color: '#fff' }}>
                            <div className="muted">Caricamento tracciato…</div>
                        </div>
                    )}
                    <canvas ref={canvasRef} className="track-canvas" />
                </div>

                <div className="leaderboard-card">
                    <div className="lb-header"><div className="lb-title">DETTAGLI PILOTA</div></div>
                    <div className="lb-list" style={{ maxHeight: 'unset' }}>
                        <div className="lb-row" style={{ gridTemplateColumns: '1fr 1fr 1fr' }}>
                            <div><div className="muted">Posizione</div><div style={{ fontWeight: 900, color: 'white' }}>{driver?.position ?? '—'}</div></div>
                            <div><div className="muted">Lap</div><div style={{ fontWeight: 900, color: 'white' }}>{driver?.lapCount ?? 0}/{totalLaps}</div></div>
                            <div><div className="muted">Velocità</div><div style={{ fontWeight: 900, color: 'white' }}>{(driver?.speedKmh ?? 0).toFixed(1)} km/h</div></div>
                        </div>

                        <div className="lb-row" style={{ gridTemplateColumns: '1fr 1fr 1fr' }}>
                            <div><div className="muted">Ultimo giro</div><div style={{ fontWeight: 900, color: 'white' }}>{formatLap(driver?.lastLapTime)}</div></div>
                            <div><div className="muted">Miglior giro</div><div style={{ fontWeight: 900, color: 'white' }}>{formatLap(driver?.bestLapTime)}</div></div>
                            <div><div className="muted">Penalità</div><div style={{ fontWeight: 900, color: 'white' }}>{driver?.penalty?.summary || '—'}</div></div>
                        </div>

                        <div className="lb-row" style={{ gridTemplateColumns: '1fr 1fr 1fr 1fr' }}>
                            <div><div className="muted">G-Lat</div><div style={{ fontWeight: 900, color: 'white' }}>{driver?.gforce?.lat?.toFixed?.(2) ?? '—'}</div></div>
                            <div><div className="muted">G-Long</div><div style={{ fontWeight: 900, color: 'white' }}>{driver?.gforce?.long?.toFixed?.(2) ?? '—'}</div></div>
                            <div><div className="muted">G-Vert</div><div style={{ fontWeight: 900, color: 'white' }}>{driver?.gforce?.vert?.toFixed?.(2) ?? '—'}</div></div>
                            <div><div className="muted">G-Total</div><div style={{ fontWeight: 900, color: 'white' }}>{driver?.gforce?.total?.toFixed?.(2) ?? '—'}</div></div>
                        </div>

                        <div className="pilot-form" style={{ marginTop: 12 }}>
                            <div className="section-title" style={{ margin: 0, fontSize: '1.2rem' }}>Tempi di tutti i giri</div>
                            <div className="lb-list" style={{ maxHeight: '40vh' }}>
                                {driver?.lapTimes?.length ? driver.lapTimes.map((t, i) => (
                                    <div key={i} className="lb-row" style={{ gridTemplateColumns: '80px 1fr 1fr' }}>
                                        <div className="lb-pos">{i + 1}</div>
                                        <div className="lb-name">Tempo</div>
                                        <div className="lb-gap" style={{ textAlign: 'right', color: '#e9ffe0', fontWeight: 900 }}>{formatLap(t)}</div>
                                    </div>
                                )) : (
                                    <div className="muted">Nessun giro completato ancora…</div>
                                )}
                            </div>
                        </div>

                    </div>
                </div>
            </div>

        </div>
    );
}
