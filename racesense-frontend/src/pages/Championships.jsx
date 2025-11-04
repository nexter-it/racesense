import React, { useState, useEffect } from "react";

export default function Championships() {
    const [championships, setChampionships] = useState([]);
    const [name, setName] = useState("");
    const [photoFile, setPhotoFile] = useState(null);
    const [photoPreview, setPhotoPreview] = useState(null);
    const [error, setError] = useState("");
    const [loading, setLoading] = useState(false);

    // === BASE URL BACKEND ===
    const API_BASE = process.env.REACT_APP_API_BASE || `http://${window.location.hostname}:5000`;

    // === Carica campionati ===
    useEffect(() => {
        fetch(`${API_BASE}/api/championships`)
            .then((res) => res.json())
            .then(setChampionships)
            .catch(() => setChampionships([]));
    }, [API_BASE]);

    // === Gestione dropzone ===
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
        const file = e.dataTransfer.files[0];
        if (file) handleFile(file);
    };

    const handleAddChampionship = async (e) => {
        e.preventDefault();
        setError("");
        if (!name.trim()) {
            setError("Inserisci il nome del campionato");
            return;
        }

        setLoading(true);
        const formData = new FormData();
        formData.append("name", name);
        if (photoFile) formData.append("photo", photoFile);

        try {
            const res = await fetch(`${API_BASE}/api/championships`, {
                method: "POST",
                body: formData,
            });

            if (!res.ok) throw new Error(`Errore HTTP ${res.status}`);
            const data = await res.json();
            setChampionships(data);
            setName("");
            setPhotoFile(null);
            setPhotoPreview(null);
        } catch (err) {
            console.error("Errore:", err);
            setError("Errore durante il salvataggio del campionato.");
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="main small-top">
            <h1 className="section-title">Campionati</h1>
            <p className="subtitle">
                Crea un nuovo campionato, assegna una foto e gestisci tutti i campionati
                già salvati.
            </p>

            {/* === FORM CREAZIONE === */}
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
                            onClick={() => document.getElementById("fileInput").click()}
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
                                id="fileInput"
                                type="file"
                                accept="image/*"
                                style={{ display: "none" }}
                                onChange={(e) => handleFile(e.target.files[0])}
                            />
                        </div>
                    </div>

                    <div className="form-col" style={{ display: "flex", alignItems: "end" }}>
                        <button type="submit" className="btn-primary" disabled={loading}>
                            {loading ? "Salvataggio..." : "Aggiungi Campionato"}
                        </button>
                    </div>
                </div>

                {error && <div className="error">{error}</div>}
            </form>

            {/* === LISTA CAMPIONATI === */}
            <h2 className="section-subtitle">Campionati salvati</h2>

            {championships.length === 0 ? (
                <div className="cr-empty">
                    <div className="cr-empty-emoji">🏁</div>
                    <div className="cr-empty-title">Nessun campionato creato</div>
                    <p className="muted">Aggiungine uno sopra per iniziare.</p>
                </div>
            ) : (
                <div className="cr-grid">
                    {championships.map((ch) => (
                        <div key={ch.id} className="cr-card">
                            <div className="cr-card-head">
                                <h3 className="cr-title">{ch.name}</h3>
                                <span className="muted small">{new Date(ch.createdAt).toLocaleDateString()}</span>
                            </div>
                            {ch.photo ? (
                                <img
                                    src={`${API_BASE}${ch.photo}`}
                                    alt={ch.name}
                                    className="cr-mini"
                                    style={{ objectFit: "cover" }}
                                />
                            ) : (
                                <div className="cr-mini"></div>
                            )}
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}
