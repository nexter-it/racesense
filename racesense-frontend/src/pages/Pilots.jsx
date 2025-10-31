import React from 'react';

/** Campionati statici richiesti */
const CHAMPIONSHIPS = ['iron', 'iron inx', 'spint'];

/** Dropzone semplice (drag&drop o click) */
function Dropzone({ label, file, onFileChange, accept = 'image/*' }) {
  const inputRef = React.useRef(null);
  const [isOver, setIsOver] = React.useState(false);

  const onDrop = (e) => {
    e.preventDefault();
    setIsOver(false);
    const f = e.dataTransfer.files?.[0];
    if (f) onFileChange(f);
  };
  const onClick = () => inputRef.current?.click();

  return (
    <div
      className={`dz ${isOver ? 'over' : ''}`}
      onDragOver={(e) => { e.preventDefault(); setIsOver(true); }}
      onDragLeave={() => setIsOver(false)}
      onDrop={onDrop}
      onClick={onClick}
      role="button"
      tabIndex={0}
    >
      {file ? (
        <div className="dz-preview">
          <img src={URL.createObjectURL(file)} alt="preview" />
          <span className="dz-filename">{file.name}</span>
        </div>
      ) : (
        <div className="dz-inner">
          <span className="dz-label">{label}</span>
          <span className="dz-hint">Trascina qui o clicca</span>
        </div>
      )}
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        style={{ display: 'none' }}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onFileChange(f);
        }}
      />
    </div>
  );
}

/** Normalizza per ricerche case/accents insensitive */
const norm = (s) =>
  (s || '')
    .toString()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');

export default function PilotsPage({ apiBase }) {
  const [list, setList] = React.useState([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState('');

  // form state
  const [name, setName] = React.useState('');
  const [surname, setSurname] = React.useState('');
  const [team, setTeam] = React.useState('');
  const [champSel, setChampSel] = React.useState([]);
  const [photoDriver, setPhotoDriver] = React.useState(null);
  const [photoTeam, setPhotoTeam] = React.useState(null);
  const [submitting, setSubmitting] = React.useState(false);

  // search state
  const [query, setQuery] = React.useState('');
  const [champFilters, setChampFilters] = React.useState([]);

  const load = React.useCallback(() => {
    setLoading(true);
    setError('');
    fetch(`${apiBase}/api/pilots`)
      .then(r => r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`)))
      .then(json => setList(json))
      .catch(e => setError(e.message || 'Errore caricamento'))
      .finally(() => setLoading(false));
  }, [apiBase]);

  React.useEffect(() => {
    load();
  }, [load]);

  const toggleChamp = (c) => {
    setChampSel(prev => prev.includes(c) ? prev.filter(x => x !== c) : [...prev, c]);
  };

  const toggleFilterChamp = (c) => {
    setChampFilters(prev => prev.includes(c) ? prev.filter(x => x !== c) : [...prev, c]);
  };

  const onSubmit = (e) => {
    e.preventDefault();
    if (!name.trim() || !surname.trim() || !team.trim()) {
      alert('Compila Nome, Cognome e Team.');
      return;
    }
    setSubmitting(true);
    const fd = new FormData();
    fd.append('name', name.trim());
    fd.append('surname', surname.trim());
    fd.append('team', team.trim());
    fd.append('championships', JSON.stringify(champSel));
    if (photoDriver) fd.append('photoDriver', photoDriver);
    if (photoTeam) fd.append('photoTeam', photoTeam);

    fetch(`${apiBase}/api/pilots`, { method: 'POST', body: fd })
      .then(r => r.ok ? r.json() : r.json().catch(() => ({})).then(j => Promise.reject(new Error(j.error || `HTTP ${r.status}`))))
      .then(() => {
        setName(''); setSurname(''); setTeam('');
        setChampSel([]); setPhotoDriver(null); setPhotoTeam(null);
        load();
      })
      .catch(e => alert(`Errore salvataggio: ${e.message}`))
      .finally(() => setSubmitting(false));
  };

  const onDelete = (id) => {
    if (!window.confirm('Eliminare il pilota?')) return;
    fetch(`${apiBase}/api/pilots/${id}`, { method: 'DELETE' })
      .then(r => r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`)))
      .then(() => setList(prev => prev.filter(p => p.id !== id)))
      .catch(e => alert(`Errore eliminazione: ${e.message}`));
  };

  /** Applica filtri di ricerca */
  const filtered = React.useMemo(() => {
    const q = norm(query);
    return list.filter(p => {
      const text =
        norm(p.name) + ' ' +
        norm(p.surname) + ' ' +
        norm(p.team);
      const textMatch = q.length === 0 || text.includes(q);

      // se nessun campionato selezionato come filtro → passa
      if (champFilters.length === 0) return textMatch;

      // altrimenti deve appartenere ad almeno un campionato selezionato
      const champs = (p.championships || []).map(norm);
      const hasAny = champFilters.some(c => champs.includes(norm(c)));
      return textMatch && hasAny;
    });
  }, [list, query, champFilters]);

  const clearFilters = () => {
    setQuery('');
    setChampFilters([]);
  };

  return (
    <div className="pilots-page">
      <div className="bg-grid" aria-hidden="true" />
      <div className="bg-glow bg-glow-1" aria-hidden="true" />
      <div className="bg-glow bg-glow-2" aria-hidden="true" />

      <main className="main small-top">
        <h2 className="section-title">Gestione Piloti</h2>

        {/* ===== FORM CREAZIONE ===== */}
        <form className="pilot-form" onSubmit={onSubmit}>
          <div className="form-row">
            <div className="form-col">
              <label>Nome</label>
              <input
                className="input"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Es. Mario"
                required
              />
            </div>
            <div className="form-col">
              <label>Cognome</label>
              <input
                className="input"
                value={surname}
                onChange={(e) => setSurname(e.target.value)}
                placeholder="Es. Rossi"
                required
              />
            </div>
            <div className="form-col">
              <label>Team</label>
              <input
                className="input"
                value={team}
                onChange={(e) => setTeam(e.target.value)}
                placeholder="Es. Nexter Racing"
                required
              />
            </div>
          </div>

          <div className="form-row">
            <div className="form-col">
              <label>Campionati</label>
              <div className="chips">
                {CHAMPIONSHIPS.map(c => (
                  <button
                    type="button"
                    key={c}
                    className={`chip ${champSel.includes(c) ? 'active' : ''}`}
                    onClick={() => toggleChamp(c)}
                  >
                    {c}
                  </button>
                ))}
              </div>
              <small className="muted">Seleziona uno o più campionati</small>
            </div>
          </div>

          <div className="form-row">
            <div className="form-col">
              <label>Foto Pilota</label>
              <Dropzone label="Foto pilota" file={photoDriver} onFileChange={setPhotoDriver} accept="image/*" />
            </div>
            <div className="form-col">
              <label>Logo Team</label>
              <Dropzone label="Logo team" file={photoTeam} onFileChange={setPhotoTeam} accept="image/*" />
            </div>
            <div className="form-col" />
          </div>

          <div className="form-actions">
            <button className="btn-primary" type="submit" disabled={submitting}>
              {submitting ? 'Salvataggio...' : 'Crea Pilota'}
            </button>
          </div>
        </form>

        {/* ===== FILTRI / RICERCA ===== */}
        <div className="pilot-search">
          <input
            className="input search-input"
            placeholder="Cerca per nome, cognome o team…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <div className="chips">
            {CHAMPIONSHIPS.map(c => (
              <span
                key={c}
                className={`chip toggle ${champFilters.includes(c) ? 'active' : ''}`}
                onClick={() => toggleFilterChamp(c)}
                role="button"
                tabIndex={0}
              >
                {c}
              </span>
            ))}
          </div>
          <div className="search-meta">
            <span className="muted">
              {loading ? 'Caricamento…' : `${filtered.length}/${list.length} risultati`}
            </span>
            {(query || champFilters.length > 0) && (
              <button className="btn-ghost" onClick={clearFilters}>Pulisci filtri</button>
            )}
          </div>
        </div>

        {/* ===== LISTA PILOTI ===== */}
        <h3 className="section-subtitle">Piloti esistenti</h3>

        {loading && <p className="muted">Caricamento...</p>}
        {error && <p className="error">{error}</p>}

        {!loading && !error && (
          filtered.length === 0 ? (
            <p className="muted">Nessun pilota corrisponde ai filtri.</p>
          ) : (
            <div className="pilots-grid">
              {filtered.map(p => (
                <div key={p.id} className="pilot-card expanded">
                  {/* Colonna foto (stretta) */}
                  <div className="pilot-photos col">
                    <div className="photo tall">
                      {p.photoDriverUrl
                        ? <img src={`${apiBase}${p.photoDriverUrl}`} alt={`${p.name} ${p.surname}`} />
                        : <div className="photo-placeholder">Pilota</div>}
                    </div>
                    <div className="photo small">
                      {p.photoTeamUrl
                        ? <img src={`${apiBase}${p.photoTeamUrl}`} alt={`${p.team}`} />
                        : <div className="photo-placeholder">Team</div>}
                    </div>
                    
                  </div>

                  {/* Colonna info (larga) */}
                  <div className="pilot-info wide">
                    <div className="pilot-name big">{p.name} {p.surname}</div>
                    <div className="pilot-team big">{p.team}</div>
                    {/* Azioni (destra) */}
                    <div className="pilot-chips">
                      {(p.championships || []).map(c => (
                        <span key={c} className="chip readonly">{c}</span>
                      ))}
                    </div>
                    <div className="pilot-actions" style={{ marginTop: '10px' }}>
                      <button className="btn-danger" onClick={() => onDelete(p.id)}>Elimina</button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )
        )}
      </main>
    </div>
  );
}
