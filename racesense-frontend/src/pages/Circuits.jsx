import React, { useState, useEffect, useRef, useMemo } from 'react';

/* ============ ICONS (inline SVG, no deps) ============ */
const Svg = ({ children, size = 16, className = '', stroke = 'currentColor', strokeWidth = 2, ...rest }) => (
    <svg
        xmlns="http://www.w3.org/2000/svg"
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        stroke={stroke}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
        className={className}
        aria-hidden="true"
        focusable="false"
        {...rest}
    >
        {children}
    </svg>
);
const IconFlag = (props) => (
    <Svg {...props}>
        <path d="M4 3v18" />
        <path d="M4 4s3-1 6 1 6 0 6 0v9s-3 1-6-1-6 0-6 0V4z" />
    </Svg>
);
const IconRuler = (props) => (
    <Svg {...props}>
        <rect x="3" y="6" width="18" height="12" rx="2" />
        <path d="M7 10h2M11 10h2M15 10h2M7 14h1M11 14h1M15 14h1" />
    </Svg>
);
const IconWidth = (props) => (
    <Svg {...props}>
        <path d="M3 12h18" />
        <path d="M7 8l-4 4 4 4M17 8l4 4-4 4" />
    </Svg>
);
const IconSearch = (props) => (
    <Svg {...props}>
        <circle cx="11" cy="11" r="7" />
        <path d="m21 21-3.8-3.8" />
    </Svg>
);
const IconEdit = (props) => (
    <Svg {...props}>
        <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
        <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
    </Svg>
);
const IconSave = (props) => (
    <Svg {...props}>
        <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
        <polyline points="17 21 17 13 7 13 7 21" />
        <polyline points="7 3 7 8 15 8" />
    </Svg>
);
const IconX = (props) => (
    <Svg {...props}>
        <line x1="18" y1="6" x2="6" y2="18" />
        <line x1="6" y1="6" x2="18" y2="18" />
    </Svg>
);

/* ===== Helpers di proiezione e fit su canvas ===== */
function projectLatLonToXY(points) {
    if (!points || points.length === 0) return [];
    const lat0 = points.reduce((s, p) => s + p.lat, 0) / points.length;
    const lon0 = points.reduce((s, p) => s + p.lon, 0) / points.length;
    const mPerDegLat = 111_132;
    const mPerDegLon = 111_320 * Math.cos((lat0 * Math.PI) / 180);
    return points.map(p => ({
        x: (p.lon - lon0) * mPerDegLon,
        y: (p.lat - lat0) * mPerDegLat * -1,
    }));
}

function fitToCanvas(localXY, width, height, padding = 20) {
    if (!localXY.length) return [];
    const xs = localXY.map(p => p.x), ys = localXY.map(p => p.y);
    const minX = Math.min(...xs), maxX = Math.max(...xs);
    const minY = Math.min(...ys), maxY = Math.max(...ys);
    const spanX = (maxX - minX) || 1, spanY = (maxY - minY) || 1;
    const scale = Math.min((width - 2 * padding) / spanX, (height - 2 * padding) / spanY);
    const offX = padding - minX * scale + (width - 2 * padding - spanX * scale) / 2;
    const offY = padding - minY * scale + (height - 2 * padding - spanY * scale) / 2;
    return localXY.map(p => ({ X: p.x * scale + offX, Y: p.y * scale + offY }));
}

/* ===== Canvas preview per le card ===== */
function MiniTrack({ points, className = '' }) {
    const ref = useRef(null);
    useEffect(() => {
        const canvas = ref.current;
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        const W = canvas.width, H = canvas.height;
        ctx.clearRect(0, 0, W, H);
        ctx.fillStyle = 'rgba(255,255,255,0.03)';
        ctx.fillRect(0, 0, W, H);
        if (!points || points.length < 2) {
            ctx.setLineDash([8, 8]);
            ctx.strokeStyle = 'rgba(255,255,255,0.20)';
            ctx.lineWidth = 2;
            ctx.strokeRect(14, 14, W - 28, H - 28);
            ctx.setLineDash([]);
            return;
        }
        const local = projectLatLonToXY(points);
        const fitted = fitToCanvas(local, W, H, 14);
        ctx.beginPath();
        fitted.forEach((p, i) => (i ? ctx.lineTo(p.X, p.Y) : ctx.moveTo(p.X, p.Y)));
        ctx.strokeStyle = 'rgba(192,255,3,0.9)';
        ctx.lineWidth = 2.5;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.shadowColor = 'rgba(192,255,3,0.35)';
        ctx.shadowBlur = 6;
        ctx.stroke();
        ctx.shadowBlur = 0;
        const s = fitted[0];
        ctx.fillStyle = '#0a0a0a';
        ctx.strokeStyle = 'rgba(255,255,255,0.85)';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(s.X, s.Y, 4, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
    }, [points]);
    return (
        <canvas
            ref={ref}
            width={320}
            height={150}
            className={`cr-mini ${className}`}
            aria-hidden="true"
        />
    );
}

/* ===== Canvas grande con settori e cordoli ===== */
function TrackCanvas({ points, sectors, width = 760, height = 420 }) {
    const ref = useRef(null);

    useEffect(() => {
        const canvas = ref.current;
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        ctx.fillStyle = 'rgba(255,255,255,0.02)';
        ctx.strokeStyle = 'rgba(192,255,3,0.18)';
        ctx.lineWidth = 1;
        ctx.strokeRect(0.5, 0.5, canvas.width - 1, canvas.height - 1);

        if (!points || points.length < 2) return;

        const local = projectLatLonToXY(points);
        const fitted = fitToCanvas(local, canvas.width, canvas.height, 24);

        // Disegna settori colorati
        if (sectors && sectors.length > 0) {
            sectors.forEach(sector => {
                const sectorPoints = fitted.slice(sector.startIdx, sector.endIdx + 1);
                if (sectorPoints.length < 2) return;

                ctx.beginPath();
                sectorPoints.forEach((p, i) => (i ? ctx.lineTo(p.X, p.Y) : ctx.moveTo(p.X, p.Y)));
                ctx.strokeStyle = sector.color;
                ctx.lineWidth = 12;
                ctx.lineCap = 'round';
                ctx.lineJoin = 'round';
                ctx.globalAlpha = 0.4;
                ctx.stroke();
                ctx.globalAlpha = 1;
            });
        }

        // Asfalto
        ctx.beginPath();
        fitted.forEach((p, i) => (i ? ctx.lineTo(p.X, p.Y) : ctx.moveTo(p.X, p.Y)));
        ctx.strokeStyle = 'rgba(80,84,90,0.95)';
        ctx.lineWidth = 10;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.stroke();

        // Bordo
        ctx.beginPath();
        fitted.forEach((p, i) => (i ? ctx.lineTo(p.X, p.Y) : ctx.moveTo(p.X, p.Y)));
        ctx.strokeStyle = 'rgba(255,255,255,0.12)';
        ctx.lineWidth = 12;
        ctx.stroke();

        // Linea start
        const s0 = fitted[0], s1 = fitted[1] || fitted[0];
        const ang = Math.atan2(s1.Y - s0.Y, s1.X - s0.X);
        ctx.save();
        ctx.translate(s0.X, s0.Y);
        ctx.rotate(ang);
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(0, -10);
        ctx.lineTo(0, 10);
        ctx.stroke();
        ctx.restore();
    }, [points, sectors]);

    return <canvas ref={ref} width={width} height={height} className="cr-canvas" />;
}

/* ===== Modal ===== */
function Modal({ open, onClose, children }) {
    if (!open) return null;
    return (
        <div className="cr-modal" role="dialog" aria-modal="true">
            <div className="cr-backdrop" onClick={onClose} />
            <div className="cr-dialog">
                <button className="cr-close" onClick={onClose} aria-label="Chiudi">×</button>
                {children}
            </div>
        </div>
    );
}

/* ===== Editor Settori ===== */
function SectorEditor({ totalPoints, sectors, onChange }) {
    const [editingSector, setEditingSector] = useState(null);

    const addSector = () => {
        if (sectors.length >= 3) return;
        const newSector = {
            id: Date.now(),
            name: `Settore ${sectors.length + 1}`,
            startIdx: 0,
            endIdx: Math.floor(totalPoints / 3),
            color: ['#ff0000', '#00ff00', '#0000ff'][sectors.length]
        };
        onChange([...sectors, newSector]);
        setEditingSector(newSector.id);
    };

    const updateSector = (id, updates) => {
        onChange(sectors.map(s => s.id === id ? { ...s, ...updates } : s));
    };

    const removeSector = (id) => {
        onChange(sectors.filter(s => s.id !== id));
        if (editingSector === id) setEditingSector(null);
    };

    return (
        <div className="ed-section">
            <div className="ed-header">
                <h3 className="ed-title">Settori ({sectors.length}/3)</h3>
                {sectors.length < 3 && (
                    <button className="btn-primary" onClick={addSector}>
                        + Aggiungi Settore
                    </button>
                )}
            </div>

            <div className="ed-list">
                {sectors.map(sector => (
                    <div key={sector.id} className="ed-item">
                        <div className="ed-item-header" onClick={() => setEditingSector(editingSector === sector.id ? null : sector.id)}>
                            <div className="ed-item-color" style={{ background: sector.color }} />
                            <span className="ed-item-name">{sector.name}</span>
                            <span className="ed-item-range">
                                {sector.startIdx} → {sector.endIdx} ({sector.endIdx - sector.startIdx + 1} punti)
                            </span>
                            <button
                                className="ed-item-del"
                                onClick={(e) => { e.stopPropagation(); removeSector(sector.id); }}
                            >
                                <IconX size={16} />
                            </button>
                        </div>

                        {editingSector === sector.id && (
                            <div className="ed-item-body">
                                <div className="ed-row">
                                    <label>Nome</label>
                                    <input
                                        className="input"
                                        value={sector.name}
                                        onChange={(e) => updateSector(sector.id, { name: e.target.value })}
                                    />
                                </div>
                                <div className="ed-row">
                                    <label>Punto Iniziale</label>
                                    <input
                                        className="input"
                                        type="number"
                                        min={0}
                                        max={totalPoints - 1}
                                        value={sector.startIdx}
                                        onChange={(e) => updateSector(sector.id, { startIdx: parseInt(e.target.value) || 0 })}
                                    />
                                </div>
                                <div className="ed-row">
                                    <label>Punto Finale</label>
                                    <input
                                        className="input"
                                        type="number"
                                        min={0}
                                        max={totalPoints - 1}
                                        value={sector.endIdx}
                                        onChange={(e) => updateSector(sector.id, { endIdx: parseInt(e.target.value) || 0 })}
                                    />
                                </div>
                                <div className="ed-row">
                                    <label>Colore</label>
                                    <input
                                        className="input"
                                        type="color"
                                        value={sector.color}
                                        onChange={(e) => updateSector(sector.id, { color: e.target.value })}
                                    />
                                </div>
                            </div>
                        )}
                    </div>
                ))}
            </div>

            {sectors.length === 0 && (
                <div className="ed-empty">
                    <p className="muted">Nessun settore definito. Aggiungi fino a 3 settori per dividere il circuito.</p>
                </div>
            )}
        </div>
    );
}

/* ===== Card singola con lazy-preview ===== */
function CircuitCard({ apiBase, circuit, onOpenDetail }) {
    const [previewPts, setPreviewPts] = useState(null);
    const [isLoading, setIsLoading] = useState(false);
    const cardRef = useRef(null);

    useEffect(() => {
        const el = cardRef.current;
        if (!el) return;
        let aborted = false;
        const controller = new AbortController();
        const io = new IntersectionObserver((entries) => {
            const v = entries[0]?.isIntersecting;
            if (!v) return;
            io.disconnect();
            setIsLoading(true);
            fetch(`${apiBase}/api/circuits/${encodeURIComponent(circuit.id)}`, { signal: controller.signal })
                .then(r => r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`)))
                .then(j => {
                    if (aborted) return;
                    const pts = (Array.isArray(j.sectors) && j.sectors.length
                        ? j.sectors.map(s => ({ lat: s.lat, lon: s.lon }))
                        : Array.isArray(j.pathPoints) ? j.pathPoints : null);
                    setPreviewPts(pts);
                })
                .catch(() => { })
                .finally(() => !aborted && setIsLoading(false));
        }, { rootMargin: '120px' });
        io.observe(el);
        return () => { aborted = true; controller.abort(); io.disconnect(); };
    }, [apiBase, circuit.id]);

    return (
        <article
            ref={cardRef}
            className="cr-card"
            role="button"
            tabIndex={0}
            onClick={() => onOpenDetail(circuit.id)}
            onKeyDown={(e) => e.key === 'Enter' && onOpenDetail(circuit.id)}
        >
            <MiniTrack points={previewPts || []} className={isLoading ? 'loading' : ''} />
            <header className="cr-card-head">
                <h3 className="cr-title">{circuit.name}</h3>
                <div className="cr-sub muted">
                    {circuit.createdAt ? new Date(circuit.createdAt).toLocaleDateString() : 'data sconosciuta'}
                </div>
            </header>
            <footer className="cr-meta">
                <span className="pill">
                    <IconFlag className="pill-ic" />
                    {(circuit.points ?? circuit.meta?.points ?? '?')} punti
                </span>
                {circuit.lengthMeters != null && (
                    <span className="pill">
                        <IconRuler className="pill-ic" />
                        {circuit.lengthMeters.toFixed(1)} m
                    </span>
                )}
                {circuit.widthMeters != null && (
                    <span className="pill">
                        <IconWidth className="pill-ic" />
                        {circuit.widthMeters} m
                    </span>
                )}
            </footer>
        </article>
    );
}

/* ===== Pagina ===== */
export default function CircuitsPage({ apiBase }) {
    const [list, setList] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [query, setQuery] = useState('');
    const [sort, setSort] = useState('date_desc');
    const [openId, setOpenId] = useState(null);
    const [detail, setDetail] = useState(null);
    const [detailLoading, setDetailLoading] = useState(false);
    const [detailError, setDetailError] = useState('');
    const [editMode, setEditMode] = useState(false);
    const [sectors, setSectors] = useState([]);
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        setLoading(true);
        setError('');
        fetch(`${apiBase}/api/circuits`)
            .then(r => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
            .then(json => setList(json || []))
            .catch(e => setError(e.message || 'Errore caricamento circuiti'))
            .finally(() => setLoading(false));
    }, [apiBase]);

    const filtered = useMemo(() => {
        const q = query.trim().toLowerCase();
        let arr = list.filter(c =>
            !q ||
            `${c.name ?? ''}`.toLowerCase().includes(q) ||
            `${c.id ?? ''}`.toLowerCase().includes(q)
        );
        switch (sort) {
            case 'name_asc':
                arr = arr.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
                break;
            case 'len_desc':
                arr = arr.sort((a, b) => (b.lengthMeters || 0) - (a.lengthMeters || 0));
                break;
            case 'date_asc':
                arr = arr.sort((a, b) => new Date(a.createdAt || 0) - new Date(b.createdAt || 0));
                break;
            default:
                arr = arr.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
        }
        return arr;
    }, [list, query, sort]);

    const openDetail = (id) => {
        setOpenId(id);
        setDetail(null);
        setDetailError('');
        setDetailLoading(true);
        setEditMode(false);
        setSectors([]);
        fetch(`${apiBase}/api/circuits/${encodeURIComponent(id)}`)
            .then(r => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
            .then(j => {
                setDetail(j);
                setSectors(j.customSectors || []);
            })
            .catch(e => setDetailError(e.message || 'Errore caricamento circuito'))
            .finally(() => setDetailLoading(false));
    };

    const saveChanges = async () => {
        if (!detail) return;
        setSaving(true);
        try {
            const updatedCircuit = {
                ...detail,
                customSectors: sectors,
            };
            const res = await fetch(`${apiBase}/api/circuits/${encodeURIComponent(detail.id)}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(updatedCircuit)
            });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            setEditMode(false);
            alert('Modifiche salvate con successo!');
        } catch (e) {
            alert('Errore durante il salvataggio: ' + e.message);
        } finally {
            setSaving(false);
        }
    };

    const points = detail ? (
        Array.isArray(detail.sectors) && detail.sectors.length
            ? detail.sectors.map(s => ({ lat: s.lat, lon: s.lon }))
            : detail.pathPoints || []
    ) : [];

    return (
        <div className="circuits-page">
            <div className="bg-grid" aria-hidden="true" />
            <div className="bg-glow bg-glow-1" aria-hidden="true" />
            <div className="bg-glow bg-glow-2" aria-hidden="true" />
            <main className="main small-top">
                <div className="circuits-header">
                    <h2 className="section-title">Circuiti</h2>
                    <div className="cr-toolbar">
                        <div className="cr-search">
                            <span className="cr-search-ic" aria-hidden="true" style={{ color: 'white' }}><IconSearch /></span>
                            <input
                                className="cr-input"
                                type="text"
                                placeholder="Cerca per nome o ID…"
                                value={query}
                                onChange={e => setQuery(e.target.value)}
                            />
                        </div>
                        <div className="cr-sort">
                            <label className="muted" htmlFor="sort">Ordina</label>
                            <select id="sort" className="cr-input" value={sort} onChange={e => setSort(e.target.value)}>
                                <option value="date_desc">Più recenti</option>
                                <option value="date_asc">Più vecchi</option>
                                <option value="name_asc">Nome (A→Z)</option>
                                <option value="len_desc">Lunghezza (↓)</option>
                            </select>
                        </div>
                    </div>
                </div>
                {loading && (
                    <div className="cr-grid">
                        {Array.from({ length: 6 }).map((_, i) => (
                            <div className="cr-card cr-skel" key={i}>
                                <div className="cr-mini" />
                                <div className="cr-skel-line" />
                                <div className="cr-skel-line short" />
                            </div>
                        ))}
                    </div>
                )}
                {error && <p className="muted">Errore: {error}</p>}
                {!loading && !error && (
                    filtered.length === 0 ? (
                        <div className="cr-empty">
                            <div className="cr-empty-emoji">📭</div>
                            <div className="cr-empty-title">Nessun circuito</div>
                            <div className="muted">Prova a rimuovere il filtro o aggiungere un nuovo tracciato.</div>
                        </div>
                    ) : (
                        <div className="cr-grid">
                            {filtered.map(c => (
                                <CircuitCard
                                    key={c.id}
                                    apiBase={apiBase}
                                    circuit={c}
                                    onOpenDetail={openDetail}
                                />
                            ))}
                        </div>
                    )
                )}
            </main>

            {/* MODALE DETTAGLIO */}
            <Modal open={!!openId} onClose={() => setOpenId(null)}>
                {detailLoading && <p className="muted" style={{ padding: '8px 0' }}>Caricamento circuito…</p>}
                {detailError && <p className="muted" style={{ padding: '8px 0' }}>Errore: {detailError}</p>}
                {detail && (
                    <div>
                        <div className="ed-toolbar">
                            <h3 className="cr-dialog-title">{detail.name}</h3>
                            <div className="ed-actions">
                                {!editMode ? (
                                    <button className="btn-primary" onClick={() => setEditMode(true)}>
                                        <IconEdit size={16} style={{ marginRight: '6px' }} />
                                        Modifica
                                    </button>
                                ) : (
                                    <>
                                        <button className="btn-ghost" onClick={() => {
                                            setEditMode(false);
                                            setSectors(detail.customSectors || []);
                                        }}>
                                            Annulla
                                        </button>
                                        <button className="btn-primary" onClick={saveChanges} disabled={saving}>
                                            <IconSave size={16} style={{ marginRight: '6px' }} />
                                            {saving ? 'Salvataggio...' : 'Salva'}
                                        </button>
                                    </>
                                )}
                            </div>
                        </div>

                        <div className="cr-body">
                            <div className="cr-block">
                                <TrackCanvas
                                    points={points}
                                    sectors={sectors}
                                />
                            </div>
                            <div className="cr-block">
                                <h2 className="cr-block-title">{detail.name}</h2>
                                <div className="cr-row"><span className="cr-key">Creato</span><span className="cr-val">{detail.createdAt ? new Date(detail.createdAt).toLocaleString() : '-'}</span></div>
                                <div className="cr-row"><span className="cr-key">Punti</span><span className="cr-val">{detail.meta?.points ?? detail.pathPoints?.length ?? '-'}</span></div>
                                <div className="cr-row"><span className="cr-key">Lunghezza</span><span className="cr-val">{detail.stats?.lengthMeters ? `${detail.stats.lengthMeters.toFixed(1)} m` : '-'}</span></div>
                                <div className="cr-row"><span className="cr-key">Larghezza</span><span className="cr-val">{detail.params?.widthMeters ? `${detail.params.widthMeters} m` : '-'}</span></div>
                                <div className="cr-row"><span className="cr-key">Spacing</span><span className="cr-val">{detail.params?.spacingMeters ? `${detail.params.spacingMeters} m` : '-'}</span></div>
                                <div className="cr-row"><span className="cr-key">minQual</span><span className="cr-val">{detail.params?.minQual ?? '-'}</span></div>
                            </div>
                        </div>

                        {editMode && (
                            <div className="ed-panel">
                                <SectorEditor
                                    totalPoints={points.length}
                                    sectors={sectors}
                                    onChange={setSectors}
                                />
                            </div>
                        )}
                    </div>
                )}
            </Modal>
        </div>
    );
}