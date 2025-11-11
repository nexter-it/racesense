// src/pages/Pulse.jsx
import React, { useState, useEffect } from 'react';

/* === SVG ICONS (inline, zero dipendenze) === */
const IconStopwatch = (props) => (
    <svg viewBox="0 0 24 24" aria-hidden="true" {...props}>
        <path fill="currentColor" d="M13 3V1h-2v2H7v2h3.09A8.998 8.998 0 1 0 21 14a9.03 9.03 0 0 0-7.91-8.94V5H17V3h-4Zm-1 4a7 7 0 1 1-7 7 7.008 7.008 0 0 1 7-7Zm0 2a1 1 0 0 0-1 1v3.382l-1.553 1.553a1 1 0 1 0 1.414 1.414l1.8-1.8A1 1 0 0 0 13 13V10a1 1 0 0 0-1-1Z" />
    </svg>
);

const IconTrophy = (props) => (
    <svg viewBox="0 0 24 24" aria-hidden="true" {...props}>
        <path fill="currentColor" d="M19 3h-2V2a1 1 0 0 0-1-1H8a1 1 0 0 0-1 1v1H5a1 1 0 0 0-1 1v2a5 5 0 0 0 4 4.9V13a3 3 0 0 0 2 2.82V19H7a1 1 0 1 0 0 2h10a1 1 0 1 0 0-2h-3v-3.18A3 3 0 0 0 16 13v-2.1A5 5 0 0 0 20 6V4a1 1 0 0 0-1-1ZM6 6V5h1v3.9A3 3 0 0 1 6 6Zm12 0a3 3 0 0 1-1 2.9V5h1v1Z" />
    </svg>
);

const IconChart = (props) => (
    <svg viewBox="0 0 24 24" aria-hidden="true" {...props}>
        <path fill="currentColor" d="M4 3a1 1 0 0 0-1 1v16h18a1 1 0 1 0 0-2H5V4a1 1 0 0 0-1-1Zm4 5a1 1 0 0 0-1 1v8h2v-8a1 1 0 0 0-1-1Zm5-3a1 1 0 0 0-1 1v11h2V6a1 1 0 0 0-1-1Zm5 6a1 1 0 0 0-1 1v5h2v-5a1 1 0 0 0-1-1Z" />
    </svg>
);

const IconShield = (props) => (
    <svg viewBox="0 0 24 24" aria-hidden="true" {...props}>
        <path fill="currentColor" d="M12 2 4 5v6c0 5 3.4 9.7 8 11 4.6-1.3 8-6 8-11V5l-8-3Zm0 2.2L18 6v5c0 4.1-2.6 7.9-6 9-3.4-1.1-6-4.9-6-9V6l6-1.8Z" />
    </svg>
);

const IconSparkles = (props) => (
    <svg viewBox="0 0 24 24" aria-hidden="true" {...props}>
        <path fill="currentColor" d="M10.5 2 9 6 5 7.5 9 9l1.5 4L12 9l4-1.5L12 6 10.5 2Zm7 5  -.75 2.25L14.5 10l2.25.75L17.5 13l.75-2.25L20.5 10l-2.25-.75L17.5 7Z" />
    </svg>
);

const IconRocket = (props) => (
    <svg viewBox="0 0 24 24" aria-hidden="true" {...props}>
        <path fill="currentColor" d="M14 3c-3.5 1.6-6.4 4.5-8 8-1.3.2-2.6.7-3.6 1.7a1 1 0 0 0 0 1.4l2.5 2.5a1 1 0 0 0 1.4 0c1-1 1.5-2.3 1.7-3.6 3.5-1.6 6.4-4.5 8-8 .4 2.6-.4 5.3-2.1 7l-3.2 3.2 2.8 2.8 3.2-3.2c1.7-1.7 4.4-2.5 7-2.1-1.6 3.5-4.5 6.4-8 8-.2 1.3-.7 2.6-1.7 3.6a1 1 0 0 1-1.4 0l-2.5-2.5a1 1 0 0 1 0-1.4c1-1 2.3-1.5 3.6-1.7C9.5 16.4 6.6 13.5 5 10 7.1 7.9 10 5 14 3Z" />
    </svg>
);

const IconUser = (props) => (
    <svg viewBox="0 0 24 24" aria-hidden="true" {...props}>
        <path fill="currentColor" d="M12 2a5 5 0 1 1 0 10 5 5 0 0 1 0-10Zm-7 18.25A4.75 4.75 0 0 1 9.75 15.5h4.5A4.75 4.75 0 0 1 19 20.25V22H5v-1.75Z" />
    </svg>
);

const IconMail = (props) => (
    <svg viewBox="0 0 24 24" aria-hidden="true" {...props}>
        <path fill="currentColor" d="M3 5a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h18a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2H3Zm0 2 9 5 9-5v2l-9 5-9-5V7Z" />
    </svg>
);

const IconPhone = (props) => (
    <svg viewBox="0 0 24 24" aria-hidden="true" {...props}>
        <path fill="currentColor" d="M6.6 10.8a15.3 15.3 0 0 0 6.6 6.6l2.2-2.2a1 1 0 0 1 1-.25c1.1.37 2.3.57 3.6.57a1 1 0 0 1 1 1v3.5a1 1 0 0 1-1 1A17 17 0 0 1 3 5a1 1 0 0 1 1-1h3.5a1 1 0 0 1 1 1c0 1.3.2 2.5.57 3.6a1 1 0 0 1-.25 1l-2.22 2.2Z" />
    </svg>
);

const IconCheck = (props) => (
    <svg viewBox="0 0 24 24" aria-hidden="true" {...props}>
        <path fill="currentColor" d="M9.6 16.6 5.3 12.3l1.4-1.4 2.9 2.9 7.7-7.7 1.4 1.4-9.1 9.1Z" />
    </svg>
);

const IconChevron = (props) => (
    <svg viewBox="0 0 24 24" aria-hidden="true" {...props}>
        <path fill="currentColor" d="M7.4 8.4 12 13l4.6-4.6 1.4 1.4L12 15.8 6 9.8l1.4-1.4Z" />
    </svg>
);

export default function PulsePage({ apiBase }) {
    const [formData, setFormData] = useState({
        name: '',
        email: '',
        phone: '',
        honeypot: '',
        consent: false,
    });
    const [submitting, setSubmitting] = useState(false);
    const [success, setSuccess] = useState(false);
    const [error, setError] = useState('');
    const [openFAQ, setOpenFAQ] = useState(null);

    const handleChange = (e) => {
        const { name, value, type, checked } = e.target;
        setFormData(prev => ({ ...prev, [name]: type === 'checkbox' ? checked : value }));
        setError('');
    };

    const validateEmail = (email) =>
        /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email);

    const handleSubmit = async (e) => {
        e.preventDefault();
        setError('');

        if (formData.honeypot) return; // bot trap

        if (!formData.name.trim()) {
            setError('Inserisci il tuo nome');
            return;
        }
        if (!validateEmail(formData.email)) {
            setError("Inserisci un'email valida");
            return;
        }
        if (!formData.phone.trim()) {
            setError('Inserisci il tuo numero di telefono');
            return;
        }
        if (!formData.consent) {
            setError('Devi acconsentire al trattamento dei dati per continuare');
            return;
        }

        setSubmitting(true);
        try {
            const res = await fetch(`${apiBase}/api/pulse/register`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    name: formData.name.trim(),
                    email: formData.email.trim(),
                    phone: formData.phone.trim(),
                }),
            });
            const data = await res.json();
            if (!res.ok) {
                throw new Error(data.error || 'Errore durante la registrazione');
            }
            setSuccess(true);
            setFormData({ name: '', email: '', phone: '', honeypot: '', consent: false });
        } catch (err) {
            setError(err.message);
        } finally {
            setSubmitting(false);
        }
    };

    const FaqItem = ({ id, q, a }) => {
        const isOpen = openFAQ === id;
        return (
            <div className={`faq-item ${isOpen ? 'open' : ''}`}>
                <button
                    type="button"
                    className="faq-head"
                    onClick={() => setOpenFAQ(isOpen ? null : id)}
                    aria-expanded={isOpen}
                    aria-controls={`faq-panel-${id}`}
                >
                    <span className="faq-q">{q}</span>
                    <IconChevron className="faq-chev" />
                </button>
                <div
                    id={`faq-panel-${id}`}
                    className="faq-panel"
                    role="region"
                    aria-hidden={!isOpen}
                >
                    <p>{a}</p>
                </div>
            </div>
        );
    };

    useEffect(() => {
        window.scrollTo({ top: 0, behavior: 'smooth' }); // 👈 forza scroll all'inizio
    }, []);

    return (
        <div className="pulse-page">
            <div className="bg-grid" aria-hidden="true" />
            <div className="bg-glow bg-glow-1" aria-hidden="true" />
            <div className="bg-glow bg-glow-2" aria-hidden="true" />

            <main className="main small-top">
                {/* HERO */}
                <div className="pulse-hero enhanced">
                    <div className="pulse-badge">
                        <IconSparkles className="badge-ic" />
                        PROSSIMAMENTE
                    </div>
                    <h1 className="pulse-title">
                        RACESENSE <span style={{ color: '#8C83FE' }}>PULSE</span>
                    </h1>
                    <p className="pulse-subtitle">
                        La piattaforma social per piloti: pubblica i tuoi tempi, confronta le performance
                        e sfida gli altri in classifiche dinamiche.
                    </p>

                    {/* KPIs */}
                    {/* <div className="pulse-kpis" aria-label="Metriche iniziali">
                        <div className="kpi-card">
                            <div className="kpi-val">10k+</div>
                            <div className="kpi-label">Giri importati (beta)</div>
                        </div>
                        <div className="kpi-card">
                            <div className="kpi-val">Illimitati</div>
                            <div className="kpi-label">Circuiti supportati</div>
                        </div>
                        <div className="kpi-card">
                            <div className="kpi-val">50 ms</div>
                            <div className="kpi-label">Ritardo live medio</div>
                        </div>
                    </div> */}

                    {/* LOGOS / TRUST */}
                    {/* <div className="pulse-logos" aria-hidden="true" title="Partner & integrazioni (placeholder)">
                        <span className="logo-pill">MyLaps</span>
                        <span className="logo-pill">RaceChrono</span>
                        <span className="logo-pill">Apex</span>
                        <span className="logo-pill">SpeedLab</span>
                    </div> */}
                </div>

                {/* FEATURES */}
                <div className="pulse-features pro">
                    <div className="pulse-feature-card">
                        <span className="pulse-feature-icon" aria-hidden="true"><IconStopwatch /></span>
                        <h3 className="pulse-feature-title">Pubblica i Tuoi Tempi</h3>
                        <p className="pulse-feature-desc">
                            Carica i tuoi giri per ogni circuito e tieni traccia della progressione con cronologia e PB.
                        </p>
                    </div>
                    <div className="pulse-feature-card">
                        <span className="pulse-feature-icon" aria-hidden="true"><IconTrophy /></span>
                        <h3 className="pulse-feature-title">Sfida Altri Piloti</h3>
                        <p className="pulse-feature-desc">
                            Classifiche globali e locali, filtri per classe e veicolo, badge per obiettivi sbloccati.
                        </p>
                    </div>
                    <div className="pulse-feature-card">
                        <span className="pulse-feature-icon" aria-hidden="true"><IconChart /></span>
                        <h3 className="pulse-feature-title">Analisi Avanzata</h3>
                        <p className="pulse-feature-desc">
                            Segmenti, delta, pace consistency e confronti con i migliori del tuo livello.
                        </p>
                    </div>
                    <div className="pulse-feature-card">
                        <span className="pulse-feature-icon" aria-hidden="true"><IconShield /></span>
                        <h3 className="pulse-feature-title">Privacy & Controllo</h3>
                        <p className="pulse-feature-desc">
                            Decidi cosa rendere pubblico. I tuoi dati restano tuoi, sempre.
                        </p>
                    </div>
                </div>

                {/* STEPS */}
                <section className="pulse-steps" aria-label="Come funziona">
                    <div className="step-card">
                        <div className="step-num">1</div>
                        <div className="step-body">
                            <h4>Richiedi Accesso</h4>
                            <p>Iscriviti alla lista per entrare tra i primi tester e ottenere badge esclusivi.</p>
                        </div>
                    </div>
                    <div className="step-card">
                        <div className="step-num">2</div>
                        <div className="step-body">
                            <h4>Crea il tuo Profilo</h4>
                            <p>Imposta veicolo, classe e preferenze. Importa i primi giri in pochi click.</p>
                        </div>
                    </div>
                    <div className="step-card">
                        <div className="step-num">3</div>
                        <div className="step-body">
                            <h4>Scala le Classifiche</h4>
                            <p>Pubblica, confronta, sfida. Migliora con insights e obiettivi progressivi.</p>
                        </div>
                    </div>
                </section>

                {/* FORM / SUCCESS */}
                {success ? (
                    <div className="pulse-success" role="status" aria-live="polite">
                        <div className="pulse-success-icon"><IconCheck /></div>
                        <h2 className="pulse-success-title">Registrazione Completata!</h2>
                        <p className="pulse-success-text">
                            Sei nella lista d'attesa. Ti avviseremo non appena l’accesso anticipato sarà disponibile.
                        </p>
                        <button className="btn-ghost" onClick={() => setSuccess(false)} style={{ marginTop: 20 }}>
                            Registra un altro pilota
                        </button>
                    </div>
                ) : (
                    <div className="pulse-form-wrapper pro">
                        <div className="pulse-form-header">
                            <div className="pulse-badge small">
                                <IconRocket className="badge-ic" /> ACCESSO PRIORITARIO
                            </div>
                            <h2 className="pulse-form-title">Unisciti ai tester iniziali</h2>
                            <p className="pulse-form-subtitle">
                                Ricevi l’invito non appena apriamo la beta privata.
                            </p>
                        </div>

                        <form className="pulse-form" onSubmit={handleSubmit} noValidate>
                            {error && (
                                <div className="pulse-error" role="alert" aria-live="assertive">
                                    <span>⚠️</span> {error}
                                </div>
                            )}

                            {/* honeypot */}
                            <input
                                type="text"
                                name="honeypot"
                                value={formData.honeypot}
                                onChange={handleChange}
                                className="hp-field"
                                tabIndex={-1}
                                autoComplete="off"
                            />

                            <div className="pulse-form-group">
                                <label htmlFor="name" className="pulse-label">Nome Completo *</label>
                                <div className="input-with-ic">
                                    <IconUser className="input-ic" />
                                    <input
                                        id="name"
                                        name="name"
                                        type="text"
                                        className="pulse-input with-ic"
                                        placeholder="Es. Mario Rossi"
                                        value={formData.name}
                                        onChange={handleChange}
                                        required
                                        autoComplete="name"
                                    />
                                </div>
                            </div>

                            <div className="pulse-form-group">
                                <label htmlFor="email" className="pulse-label">Email *</label>
                                <div className="input-with-ic">
                                    <IconMail className="input-ic" />
                                    <input
                                        id="email"
                                        name="email"
                                        type="email"
                                        className="pulse-input with-ic"
                                        placeholder="tua.email@esempio.com"
                                        value={formData.email}
                                        onChange={handleChange}
                                        required
                                        autoComplete="email"
                                    />
                                </div>
                            </div>

                            <div className="pulse-form-group">
                                <label htmlFor="phone" className="pulse-label">Numero di Telefono *</label>
                                <div className="input-with-ic">
                                    <IconPhone className="input-ic" />
                                    <input
                                        id="phone"
                                        name="phone"
                                        type="tel"
                                        className="pulse-input with-ic"
                                        placeholder="+39 123 456 7890"
                                        value={formData.phone}
                                        onChange={handleChange}
                                        required
                                        autoComplete="tel"
                                    />
                                </div>
                            </div>

                            <label className="consent-row">
                                <input
                                    type="checkbox"
                                    name="consent"
                                    checked={formData.consent}
                                    onChange={handleChange}
                                />
                                <span>
                                    Acconsento al trattamento dei dati per ricevere comunicazioni sul lancio della piattaforma.
                                </span>
                            </label>

                            <button
                                type="submit"
                                className="pulse-submit"
                                disabled={submitting || !formData.consent}
                            >
                                {submitting ? 'Registrazione…' : 'Richiedi Accesso'}
                            </button>

                            <p className="pulse-privacy">
                                Usiamo i tuoi dati solo per informarti sul lancio. Potrai disiscriverti in qualsiasi momento.
                            </p>
                        </form>
                    </div>
                )}

                {/* FAQ */}
                <section className="pulse-faq">
                    <h3 className="pulse-faq-title">Domande Frequenti</h3>
                    <div className="faq-list">
                        <FaqItem
                            id="quando"
                            q="Quando parte la beta?"
                            a="Stiamo finalizzando la beta privata: inviti scaglionati a partire dal Q1 2026. Gli iscritti con accesso prioritario verranno contattati per primi."
                        />
                        <FaqItem
                            id="costi"
                            q="Quanto costa?"
                            a="L’accesso alla beta è gratuito. In futuro prevediamo un piano free e piani pro per funzioni avanzate."
                        />
                        <FaqItem
                            id="dispositivi"
                            q="Quali dispositivi supportate?"
                            a="Web app ottimizzata desktop/mobile all’inizio, con integrazioni ai principali logger. App native in roadmap."
                        />
                        <FaqItem
                            id="privacy"
                            q="Chi può vedere i miei tempi?"
                            a="Tu decidi: profilo privato, solo amici o pubblico. La privacy è configurabile per singolo contenuto."
                        />
                    </div>
                </section>

                {/* FOOTER COUNTDOWN (resta invariato ma con look migliorato via CSS) */}
                <div className="pulse-footer">
                    <div className="pulse-countdown">
                        <span className="pulse-countdown-label">Lancio previsto</span>
                        <span className="pulse-countdown-value">Q1 2026</span>
                    </div>
                </div>
            </main>
        </div>
    );
}
