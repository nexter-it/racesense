import React, { useState, useEffect } from "react";

export default function Championships() {
  const [championships, setChampionships] = useState([]);
  const [name, setName] = useState("");
  const [photoFile, setPhotoFile] = useState(null);
  const [photoPreview, setPhotoPreview] = useState(null);
  const [error, setError] = useState("");
  const [creating, setCreating] = useState(false);
  const [busyById, setBusyById] = useState({}); // { [champId]: boolean }
  const [formulaInputs, setFormulaInputs] = useState({}); // { [champId]: "label" }

  const API_BASE = process.env.REACT_APP_API_BASE || `http://${window.location.hostname}:5000`;

  // === Load championships ===
  useEffect(() => {
    let alive = true;
    fetch(`${API_BASE}/api/championships`)
      .then((res) => res.json())
      .then((data) => {
        if (!alive) return;
        setChampionships(Array.isArray(data) ? data : []);
      })
      .catch(() => {
        if (!alive) return;
        setChampionships([]);
      });
    return () => { alive = false; };
  }, [API_BASE]);

  // === Dropzone / file selection ===
  const handleFile = (file) => {
    if (!file) return;
    setPhotoFile(file);
    const reader = new FileReader();
    reader.onloadend = () => setPhotoPreview(reader.result);
    reader.readAsDataURL(file);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    const file = e.dataTransfer.files?.[0];
    if (file) handleFile(file);
  };

  // === Create championship ===
  const handleAddChampionship = async (e) => {
    e.preventDefault();
    setError("");
    if (!name.trim()) {
      setError("Inserisci il nome del campionato");
      return;
    }
    try {
      setCreating(true);
      const formData = new FormData();
      formData.append("name", name.trim());
      if (photoFile) formData.append("photo", photoFile);

      const res = await fetch(`${API_BASE}/api/championships`, {
        method: "POST",
        body: formData,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setChampionships(Array.isArray(data) ? data : []);
      setName("");
      setPhotoFile(null);
      setPhotoPreview(null);
    } catch (err) {
      console.error(err);
      setError("Errore durante il salvataggio del campionato.");
    } finally {
      setCreating(false);
    }
  };

  // === Delete championship ===
  const handleDeleteChampionship = async (id) => {
    const ok = window.confirm("Eliminare definitivamente questo campionato?");
    if (!ok) return;
    setBusyById((s) => ({ ...s, [id]: true }));
    try {
      const res = await fetch(`${API_BASE}/api/championships/${id}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json(); // backend ritorna l'elenco aggiornato
      setChampionships(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error(err);
      alert("Errore durante l'eliminazione del campionato.");
    } finally {
      setBusyById((s) => ({ ...s, [id]: false }));
    }
  };

  // === Add formula to a championship ===
  const handleAddFormula = async (champId) => {
    const label = (formulaInputs[champId] || "").trim();
    if (!label) return;
    setBusyById((s) => ({ ...s, [champId]: true }));
    try {
      const res = await fetch(`${API_BASE}/api/championships/${champId}/formulas`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const updatedChamp = await res.json(); // backend ritorna il campionato aggiornato
      setChampionships((prev) =>
        prev.map((c) => (c.id === updatedChamp.id ? updatedChamp : c))
      );
      setFormulaInputs((s) => ({ ...s, [champId]: "" }));
    } catch (err) {
      console.error(err);
      alert("Errore durante l'aggiunta della formula.");
    } finally {
      setBusyById((s) => ({ ...s, [champId]: false }));
    }
  };

  // === Delete a single formula ===
  const handleDeleteFormula = async (champId, formulaId) => {
    setBusyById((s) => ({ ...s, [champId]: true }));
    try {
      const res = await fetch(`${API_BASE}/api/championships/${champId}/formulas/${formulaId}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const updatedChamp = await res.json(); // backend ritorna il campionato aggiornato
      setChampionships((prev) =>
        prev.map((c) => (c.id === updatedChamp.id ? updatedChamp : c))
      );
    } catch (err) {
      console.error(err);
      alert("Errore durante l'eliminazione della formula.");
    } finally {
      setBusyById((s) => ({ ...s, [champId]: false }));
    }
  };

  const onChangeFormulaInput = (champId, value) => {
    setFormulaInputs((s) => ({ ...s, [champId]: value }));
  };

  return (
    <div className="main small-top">
      <h1 className="section-title">Campionati</h1>
      <p className="subtitle">
        Crea un nuovo campionato, assegna una foto e gestisci categorie (formule) direttamente dalle card.
      </p>

      {/* === CREATE FORM === */}
      <form className="pilot-form" onSubmit={handleAddChampionship}>
        <div className="form-row">
          <div className="form-col">
            <label>Nome del Campionato *</label>
            <input
              type="text"
              className="input"
              placeholder="Es. Formula GP Italia"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>

          <div className="form-col">
            <label>Foto Campionato (opzionale)</label>
            <div
              className={`dz ${photoPreview ? "has-preview" : ""}`}
              onDragOver={(e) => e.preventDefault()}
              onDrop={handleDrop}
              onClick={() => document.getElementById("fileInputChampPhoto").click()}
            >
              {!photoPreview ? (
                <div className="dz-inner">
                  <span className="dz-label">Trascina qui o clicca per caricare</span>
                  <span className="dz-hint">Formato .jpg, .png, .webp</span>
                </div>
              ) : (
                <div className="dz-preview">
                  <img src={photoPreview} alt="Preview" />
                  <span className="dz-filename">{photoFile?.name}</span>
                </div>
              )}
              <input
                id="fileInputChampPhoto"
                type="file"
                accept="image/*"
                style={{ display: "none" }}
                onChange={(e) => handleFile(e.target.files?.[0])}
              />
            </div>
          </div>

          <div className="form-col" style={{ display: "flex", alignItems: "end" }}>
            <button type="submit" className="btn-primary" disabled={creating}>
              {creating ? "Salvataggio..." : "Aggiungi Campionato"}
            </button>
          </div>
        </div>

        {error && <div className="error">{error}</div>}
      </form>

      {/* === LIST === */}
      <h2 className="section-subtitle">Campionati salvati</h2>

      {championships.length === 0 ? (
        <div className="cr-empty">
          <div className="cr-empty-emoji">🏁</div>
          <div className="cr-empty-title">Nessun campionato creato</div>
          <p className="muted">Aggiungine uno sopra per iniziare.</p>
        </div>
      ) : (
        <div className="cr-grid cr-grid--champ">
          {championships.map((ch) => {
            const isBusy = !!busyById[ch.id];
            const createdStr = ch.createdAt
              ? new Date(ch.createdAt).toLocaleDateString()
              : "";
            const formulas = Array.isArray(ch.formulas) ? ch.formulas : [];

            return (
              <div key={ch.id} className="cr-card championship-card">
                {/* Hero area con immagine intera (contain) */}
                <div className="cr-hero">
                  {ch.photo ? (
                    <div className="cr-photo">
                      <img
                        src={`${API_BASE}${ch.photo}`}
                        alt={ch.name}
                        loading="lazy"
                      />
                    </div>
                  ) : (
                    <div className="cr-photo no-photo">
                      <span className="muted">Nessuna immagine</span>
                    </div>
                  )}

                  <div className="cr-hero-info">
                    <div className="cr-hero-titles">
                      <h3 className="cr-title">{ch.name}</h3>
                      {createdStr && (
                        <span className="muted small">{createdStr}</span>
                      )}
                    </div>

                    <div className="cr-hero-actions">
                      {/* <button
                        className="btn-ghost small"
                        disabled={isBusy}
                        onClick={() => {
                          navigator.clipboard.writeText(ch.id).catch(() => { });
                        }}
                        title="Copia ID campionato"
                      >
                        ID
                      </button> */}
                      <button
                        className="btn-danger small"
                        disabled={isBusy}
                        onClick={() => handleDeleteChampionship(ch.id)}
                        title="Elimina campionato"
                      >
                        {isBusy ? "..." : "Elimina"}
                      </button>
                    </div>
                  </div>
                </div>

                {/* Formule (categorie) */}
                <span className="formula-title">Formule</span>
                <div className="formula-block">
                  <div className="formula-head">
                    <div className="formula-add">
                      <input
                        style={{ width: "80%" }}
                        className="input formula-input"
                        placeholder="Nuova formula (es. KZ2, MINI, AM)"
                        value={formulaInputs[ch.id] || ""}
                        onChange={(e) => onChangeFormulaInput(ch.id, e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            handleAddFormula(ch.id);
                          }
                        }}
                      />
                      <button
                        className="btn-primary small"
                        disabled={isBusy || !(formulaInputs[ch.id] || "").trim()}
                        onClick={() => handleAddFormula(ch.id)}
                      >
                        +
                      </button>
                    </div>
                  </div>

                  {formulas.length === 0 ? (
                    <div className="formula-empty muted">Nessuna formula presente.</div>
                  ) : (
                    <div className="formula-list">
                      {formulas.map((f) => (
                        <div key={f.id} className="formula-chip" title={f.label}>
                          <span className="formula-dot" />
                          <span className="formula-text">{f.label}</span>
                          <button
                            className="btn-icon"
                            aria-label="Elimina formula"
                            disabled={isBusy}
                            onClick={() => handleDeleteFormula(ch.id, f.id)}
                          >
                            ×
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
