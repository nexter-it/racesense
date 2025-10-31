import React from 'react';

/** Utils: proiezione locale (lat/lon → x,y in metri), poi fit su canvas */
function projectLatLonToXY(points) {
    if (!points || points.length === 0) return [];
    // centro geografico
    const lat0 = points.reduce((s, p) => s + p.lat, 0) / points.length;
    const lon0 = points.reduce((s, p) => s + p.lon, 0) / points.length;

    // metri per grado (approssimazione valida su piccole aree)
    const mPerDegLat = 111_132; // ~m/deg lat
    const mPerDegLon = 111_320 * Math.cos(lat0 * Math.PI / 180); // ~m/deg lon scalato

    return points.map(p => ({
        x: (p.lon - lon0) * mPerDegLon,
        y: (p.lat - lat0) * mPerDegLat * -1, // inverti Y (lat ↑ = y ↓ nel canvas)
    }));
}

/** Fit in canvas con padding, mantiene aspect ratio */
function fitToCanvas(localXY, width, height, padding = 20) {
    if (localXY.length === 0) return [];
    const xs = localXY.map(p => p.x), ys = localXY.map(p => p.y);
    const minX = Math.min(...xs), maxX = Math.max(...xs);
    const minY = Math.min(...ys), maxY = Math.max(...ys);
    const spanX = (maxX - minX) || 1;
    const spanY = (maxY - minY) || 1;

    const scaleX = (width - 2 * padding) / spanX;
    const scaleY = (height - 2 * padding) / spanY;
    const scale = Math.min(scaleX, scaleY);

    const offX = padding - minX * scale + (width - 2 * padding - spanX * scale) / 2;
    const offY = padding - minY * scale + (height - 2 * padding - spanY * scale) / 2;

    return localXY.map(p => ({
        X: p.x * scale + offX,
        Y: p.y * scale + offY
    }));
}

/** Canvas track renderer */
function TrackCanvas({ points, width = 700, height = 420, stroke = 'rgba(192,255,3,0.95)' }) {
    const ref = React.useRef(null);

    React.useEffect(() => {
        const canvas = ref.current;
        if (!canvas || !points || points.length < 2) return;
        const ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        // proiezione e fit
        const local = projectLatLonToXY(points);
        const fitted = fitToCanvas(local, canvas.width, canvas.height, 24);

        // bordo
        ctx.fillStyle = 'rgba(255,255,255,0.02)';
        ctx.strokeStyle = 'rgba(192,255,3,0.25)';
        ctx.lineWidth = 1;
        ctx.strokeRect(0.5, 0.5, canvas.width - 1, canvas.height - 1);

        // tracciato
        ctx.beginPath();
        fitted.forEach((p, i) => {
            if (i === 0) ctx.moveTo(p.X, p.Y);
            else ctx.lineTo(p.X, p.Y);
        });
        ctx.strokeStyle = stroke;
        ctx.lineWidth = 3;
        ctx.shadowColor = 'rgba(192,255,3,0.35)';
        ctx.shadowBlur = 8;
        ctx.stroke();
        ctx.shadowBlur = 0;

        // punto di start (primo)
        const s = fitted[0];
        ctx.fillStyle = '#000';
        ctx.strokeStyle = 'rgba(192,255,3,0.8)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(s.X, s.Y, 6, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
    }, [points]);

    return <canvas ref={ref} width={width} height={height} style={{ width: '100%', height: 'auto', borderRadius: 12 }} />;
}

/** Modal semplice */
function Modal({ open, onClose, children }) {
    if (!open) return null;
    return (
        <div className="cr-modal">
            <div className="cr-backdrop" onClick={onClose} />
            <div className="cr-dialog">
                <button className="cr-close" onClick={onClose} aria-label="Chiudi">×</button>
                {children}
            </div>
        </div>
    );
}

export default function CircuitsPage({ apiBase }) {
    const [list, setList] = React.useState([]);
    const [loading, setLoading] = React.useState(true);
    const [error, setError] = React.useState('');

    const [openId, setOpenId] = React.useState(null);
    const [detail, setDetail] = React.useState(null);
    const [detailLoading, setDetailLoading] = React.useState(false);
    const [detailError, setDetailError] = React.useState('');

    React.useEffect(() => {
        setLoading(true);
        setError('');
        fetch(`${apiBase}/api/circuits`)
            .then(r => r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`)))
            .then(json => setList(json))
            .catch(e => setError(e.message || 'Errore caricamento circuiti'))
            .finally(() => setLoading(false));
    }, [apiBase]);

    const openDetail = (id) => {
        setOpenId(id);
        setDetail(null);
        setDetailError('');
        setDetailLoading(true);
        fetch(`${apiBase}/api/circuits/${encodeURIComponent(id)}`)
            .then(r => r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`)))
            .then(j => setDetail(j))
            .catch(e => setDetailError(e.message || 'Errore caricamento circuito'))
            .finally(() => setDetailLoading(false));
    };

    return (
        <div className="circuits-page">
            <style>{`
        .circuits-header { display:flex; align-items:center; justify-content:space-between; margin-bottom: 14px; }
        .section-title{ color: var(--brand); font-weight: 900; font-size: 1.8rem; letter-spacing:.5px; }
        .muted{ color: var(--muted); }
        .cr-grid{
          display:grid;
          grid-template-columns: repeat(3, minmax(0,1fr));
          gap: 14px;
        }
        .cr-card{
          background: linear-gradient(180deg, rgba(255,255,255,0.06), rgba(255,255,255,0.02));
          border: 1px solid var(--line);
          border-radius: var(--radius);
          padding: 14px;
          box-shadow: var(--shadow);
          cursor: pointer;
          transition: .2s;
        }
        .cr-card:hover{ transform: translateY(-2px); border-color: rgba(192,255,3,0.55); }
        .cr-title{ font-weight: 900; color:white;}
        @media (max-width: 960px){ .cr-grid{ grid-template-columns: 1fr; } }

        /* Modal */
        .cr-modal{ position: fixed; inset:0; z-index: 50; }
        .cr-backdrop{ position:absolute; inset:0; background:rgba(0,0,0,0.6); }
        .cr-dialog{
          position:absolute; inset:auto 0 0 0; margin:auto; top:8%;
          max-width: 980px; width: calc(100% - 24px);
          background: linear-gradient(180deg, rgba(20,20,20,0.98), rgba(10,10,10,0.98));
          border: 1px solid var(--line); border-radius: 16px; box-shadow: var(--shadow);
          padding: 16px;
        }
        .cr-close{
          position:absolute; top:8px; right:10px; background:transparent; border: none;
          font-size: 28px; color: var(--fg); cursor:pointer; line-height:1;
        }
        .cr-body{ display:grid; grid-template-columns: 1.2fr .8fr; gap: 14px; }
        @media (max-width: 960px){ .cr-body{ grid-template-columns: 1fr; } }
        .cr-block{ background: var(--glass); border: 1px solid var(--line); border-radius: 12px; padding: 12px; }
        .cr-block h4{ margin-bottom: 8px; color:white}
        .cr-row{ display:flex; justify-content: space-between; margin-bottom: 6px; }
        .cr-key{ color: var(--muted); }
        .cr-val{ font-weight: 700; color:white}
      `}</style>

            <div className="bg-grid" aria-hidden="true" />
            <div className="bg-glow bg-glow-1" aria-hidden="true" />
            <div className="bg-glow bg-glow-2" aria-hidden="true" />

            <main className="main small-top">
                <div className="circuits-header">
                    <h2 className="section-title">Circuiti</h2>
                    <span className="muted">{loading ? 'Caricamento...' : `${list.length} trovati`}</span>
                </div>

                {error && <p className="muted">Errore: {error}</p>}

                {!loading && !error && (
                    list.length === 0 ? (
                        <p className="muted">Nessun circuito trovato in <code>data/circuiti</code>.</p>
                    ) : (
                        <div className="cr-grid">
                            {list.map(c => (
                                <div key={c.id} className="cr-card" onClick={() => openDetail(c.id)}>
                                    <div className="cr-title">{c.name}</div>
                                    <div className="muted" style={{ fontSize: '.9rem', marginTop: 2 }}>
                                        {c.createdAt ? new Date(c.createdAt).toLocaleString() : 'data sconosciuta'}
                                    </div>
                                    <div className="cr-meta">
                                        <span className="pill">{c.points} punti</span>
                                        {c.lengthMeters != null && <span className="pill">{c.lengthMeters.toFixed(1)} m</span>}
                                        {c.widthMeters != null && (
                                            <span className="pill" title="Larghezza del tracciato">
                                                ↔︎ {c.widthMeters} m
                                            </span>
                                        )}
                                        {/* <span className="pill" title={c.filename}>{c.id}</span> */}
                                    </div>
                                </div>
                            ))}
                        </div>
                    )
                )}
            </main>

            {/* MODAL DETTAGLIO */}
            <Modal open={!!openId} onClose={() => setOpenId(null)}>
                {detailLoading && <p className="muted" style={{ padding: '8px 0' }}>Caricamento circuito...</p>}
                {detailError && <p className="muted" style={{ padding: '8px 0' }}>Errore: {detailError}</p>}
                {detail && (
                    <div>
                        <h3 style={{ margin: '6px 0 12px 4px', color: 'white' }}>{detail.name}</h3>
                        <div className="cr-body">
                            <div className="cr-block">
                                <TrackCanvas points={detail.pathPoints || []} />
                            </div>
                            <div className="cr-block">
                                <h4>Dati</h4>
                                <div className="cr-row"><span className="cr-key">ID </span><span className="cr-val" title={detail.id}>{detail.id}</span></div>
                                <div className="cr-row"><span className="cr-key">Creato</span><span className="cr-val">{detail.createdAt ? new Date(detail.createdAt).toLocaleString() : '-'}</span></div>
                                <div className="cr-row"><span className="cr-key">Punti</span><span className="cr-val">{detail.meta?.points ?? detail.pathPoints?.length ?? '-'}</span></div>
                                <div className="cr-row"><span className="cr-key">Lunghezza</span><span className="cr-val">{detail.stats?.lengthMeters ? `${detail.stats.lengthMeters.toFixed(1)} m` : '-'}</span></div>
                                <div className="cr-row"><span className="cr-key">Larghezza</span><span className="cr-val">{detail.params?.widthMeters ? `${detail.params.widthMeters} m` : '-'}</span></div>
                                <div className="cr-row"><span className="cr-key">Spacing</span><span className="cr-val">{detail.params?.spacingMeters ? `${detail.params.spacingMeters} m` : '-'}</span></div>
                                <div className="cr-row"><span className="cr-key">minQual</span><span className="cr-val">{detail.params?.minQual ?? '-'}</span></div>
                            </div>
                        </div>
                    </div>
                )}
            </Modal>
        </div>
    );
}
