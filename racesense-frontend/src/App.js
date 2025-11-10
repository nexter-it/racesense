// src/App.js
import React from 'react';
import { BrowserRouter, Routes, Route, Link, useNavigate } from 'react-router-dom';
import './App.css';
import logo from './img/logonexter.png';
import PilotsPage from './pages/Pilots';
import CircuitsPage from './pages/Circuits';
import RacePage from './pages/Race';
import PilotLive from './pages/PilotLive'; // ⬅⬅ NUOVO
import Championships from './pages/Championships';
import PulsePage from './pages/Pulse';
import AuthGate from './components/AuthGate';

const API_BASE = process.env.REACT_APP_API_BASE || `http://${window.location.hostname}:5000`;
function BackendStatusBox() {
  const [status, setStatus] = React.useState('checking');
  React.useEffect(() => {
    let alive = true;
    fetch(`${API_BASE}/health`).then(r => r.ok ? r.json() : Promise.reject())
      .then(j => { if (!alive) return; setStatus(j?.ok ? 'ok' : 'down'); })
      .catch(() => { if (!alive) return; setStatus('down'); });
    return () => { alive = false; };
  }, []);
  return (
    <div className="status-box" role="status" title={`Backend: ${API_BASE}`}>
      <span className={`dot ${status}`} />
      <div className="status-texts">
        <strong>Backend</strong>
        <small className="muted">
          {status === 'checking' ? 'verifica...' : status === 'ok' ? 'connesso' : 'non raggiungibile'}
        </small>
      </div>
    </div>
  );
}

const IconTrack = (props) => (
  <svg viewBox="0 0 24 24" aria-hidden="true" {...props}>
    <path d="M4 12a8 8 0 1 1 16 0v3a3 3 0 0 1-3 3h-2a1 1 0 1 1 0-2h2a1 1 0 0 0 1-1v-3a6 6 0 1 0-12 0v3a1 1 0 0 0 1 1h2a1 1 0 1 1 0 2H7a3 3 0 0 1-3-3v-3z" fill="currentColor" />
    <circle cx="12" cy="12" r="2.25" fill="currentColor" />
  </svg>
);
const IconDriver = (props) => (
  <svg viewBox="0 0 24 24" aria-hidden="true" {...props}>
    <path d="M12 2a5 5 0 0 1 5 5v1a5 5 0 1 1-10 0V7a5 5 0 0 1 5-5zm-7 18.25A4.75 4.75 0 0 1 9.75 15.5h4.5A4.75 4.75 0 0 1 19 20.25V22H5v-1.75z" fill="currentColor" />
  </svg>
);
const IconCup = (props) => (
  <svg viewBox="0 0 24 24" aria-hidden="true" {...props}>
    <path d="M19 4h-2V3a1 1 0 0 0-1-1H8a1 1 0 0 0-1 1v1H5a1 1 0 0 0-1 1v2a5 5 0 0 0 4 4.9V14a3 3 0 0 0 2 2.82V19H7a1 1 0 1 0 0 2h10a1 1 0 1 0 0-2h-3v-2.18A3 3 0 0 0 16 14v-2.1A5 5 0 0 0 20 7V5a1 1 0 0 0-1-1zM6 7V6h1v3.9A3 3 0 0 1 6 7zm12 0a3 3 0 0 1-1 2.9V6h1v1z" fill="currentColor" />
  </svg>
);
const IconPlayFlag = (props) => (
  <svg viewBox="0 0 24 24" aria-hidden="true" {...props}>
    <path d="M5 3a1 1 0 0 0-1 1v17a1 1 0 1 0 2 0v-5.382l.553.276A5 5 0 0 0 10.764 16h5.472a3.764 3.764 0 0 0 0-7.528H12a3 3 0 0 1-1.342-.318L6 6.382V4a1 1 0 0 0-1-1z" fill="currentColor" />
  </svg>
);

function Home() {
  const navigate = useNavigate();
  return (
    <>
      <div className="bg-grid" aria-hidden="true" />
      <div className="bg-glow bg-glow-1" aria-hidden="true" />
      <div className="bg-glow bg-glow-2" aria-hidden="true" />
      <main className="main">
        <h1 className="main-title">RACESENSE<span className="title-accent" /></h1>
        <p className="subtitle">Crea circuiti, gestisci piloti e campionati, avvia la gara con un click.</p>
        <section className="actions" aria-label="Azioni rapide">
          <div className="action-card" role="button" tabIndex={0} onClick={() => navigate('/circuiti')}>
            <div className="action-icon"><IconTrack className="icon" /></div>
            <h3 className="action-title">Circuiti</h3>
            <p className="action-desc">Visualizza e analizza tracciati.</p>
          </div>
          <div className="action-card" role="button" tabIndex={0} onClick={() => navigate('/piloti')}>
            <div className="action-icon"><IconDriver className="icon" /></div>
            <h3 className="action-title">Piloti</h3>
            <p className="action-desc">Gestisci roster, team e idoneità di gara.</p>
          </div>
          <div className="action-card" role="button" tabIndex={0} onClick={() => navigate('/campionati')}>
            <div className="action-icon"><IconCup className="icon" /></div>
            <h3 className="action-title">Campionati</h3>
            <p className="action-desc">Crea e gestisci campionati e classifiche.</p>
          </div>
        </section>
        <div className="cta-wrapper">
          <button className="race-btn big-cta" aria-label="Avvia gara" onClick={() => navigate('/race')}>
            <span className="cta-icon"><IconPlayFlag className="icon" /></span>
            START RACE
          </button>
          <p className="cta-hint">Tutto pronto? Avvia lo start con semaforo virtuale.</p>
        </div>

        {/* === RACESENSE PULSE (home) === */}
        <section style={{ marginTop: '44px', paddingTop: '44px', borderTop: '1px solid var(--line)' }}>
          <div className="pulse-hero enhanced" style={{ marginBottom: 22 }}>
            <div className="pulse-badge">ACCESSO PRIORITARIO</div>
            <h2 className="pulse-title" style={{ fontSize: 'clamp(1.8rem,4vw,2.6rem)' }}>
              <span style={{ color: 'var(--brand)' }}>RACESENSE</span> PULSE
            </h2>
            <p className="pulse-subtitle" style={{ margin: '8px auto 0', fontSize: '1rem', maxWidth: 720 }}>
              La piattaforma social per piloti: pubblica i tuoi tempi, confronta le performance e scala le classifiche.
            </p>

            {/* mini KPIs */}
            {/* <div className="pulse-kpis" style={{ maxWidth: 780 }}>
              <div className="kpi-card">
                <div className="kpi-val">120+</div>
                <div className="kpi-label">Circuiti</div>
              </div>
              <div className="kpi-card">
                <div className="kpi-val">10k+</div>
                <div className="kpi-label">Giri importati</div>
              </div>
              <div className="kpi-card">
                <div className="kpi-val">Q2 2025</div>
                <div className="kpi-label">Lancio</div>
              </div>
            </div> */}
          </div>

          {/* feature highlights */}
          {/* <div className="pulse-features" style={{ marginTop: 18 }}>
            <div className="pulse-feature-card">
              <div className="pulse-feature-icon">⏱️</div>
              <h3 className="pulse-feature-title">Pubblica i Tuoi Tempi</h3>
              <p className="pulse-feature-desc">Storico giri, PB e progressione per circuito/veicolo.</p>
            </div>
            <div className="pulse-feature-card">
              <div className="pulse-feature-icon">🏆</div>
              <h3 className="pulse-feature-title">Sfida & Classifiche</h3>
              <p className="pulse-feature-desc">Ranking globali/locali, filtri per classe e badge.</p>
            </div>
            <div className="pulse-feature-card">
              <div className="pulse-feature-icon">📊</div>
              <h3 className="pulse-feature-title">Analisi Avanzata</h3>
              <p className="pulse-feature-desc">Delta, consistenza, confronto con i migliori.</p>
            </div>
          </div> */}

          {/* CTA */}
          <div className="cta-wrapper" style={{ marginTop: 26 }}>
            <button
              className="btn-primary"
              onClick={() => navigate('/pulse')}
              style={{ fontSize: '1.05rem', padding: '14px 26px', fontWeight: 900 }}
            >
              Richiedi Accesso Anticipato
            </button>
            <p className="cta-hint">Iscriviti ora: inviti in arrivo per la beta privata.</p>
          </div>
        </section>
      </main>
    </>
  );
}

export default function App() {
  const API_BASE = process.env.REACT_APP_API_BASE || `http://${window.location.hostname}:5000`;
  return (
    <BrowserRouter>
      <AuthGate />
      <header className="topbar">
        <div className="topbar-left">
          <img src={logo} alt="Logo Nexter" className="brand-logo" />
          {/* <h4 className="main-title">RACESENSE<span className="title-accent" /></h4> */}
          <span className="brand-badge">v0.1 beta</span>
        </div>
        <BackendStatusBox />
      </header>

      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/circuiti" element={<CircuitsPage apiBase={API_BASE} />} />
        <Route path="/piloti" element={<PilotsPage apiBase={API_BASE} />} />
        <Route path="/campionati" element={<Championships />} />
        <Route path="/race" element={<RacePage />} />
        <Route path="/pilot/:mac" element={<PilotLive />} /> {/* ⬅⬅ NUOVA PAGINA */}
        <Route path="/pulse" element={<PulsePage apiBase={API_BASE} />} />
        <Route path="*" element={<Home />} />
      </Routes>

      <footer className="app-footer">
        <div className="footer-content">
          <p className="developed-by">sviluppato da</p>
          <img src={logo} alt="Logo Nexter" className="footer-logo" />
        </div>
      </footer>
    </BrowserRouter>
  );
}
