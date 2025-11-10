import React, { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';

const PASS = process.env.REACT_APP_GATE_PASSWORD || 'changeme';
const STORAGE_KEY = 'rs_auth_ok_v1';

export default function AuthGate() {
    const { pathname } = useLocation();
    const [ok, setOk] = useState(() => localStorage.getItem(STORAGE_KEY) === '1');
    const [pw, setPw] = useState('');
    const [err, setErr] = useState('');

    // Pagine esenti (solo /pulse)
    const isPublic = pathname.startsWith('/pulse');

    useEffect(() => {
        if (isPublic) return; // non mostrare banner su /pulse
        setErr('');
    }, [pathname, isPublic]);

    if (isPublic || ok) return null;

    const submit = (e) => {
        e.preventDefault();
        if (pw === PASS) {
            localStorage.setItem(STORAGE_KEY, '1');
            setOk(true);
        } else {
            setErr('Password non corretta');
        }
    };

    return (
        <div style={styles.backdrop} role="dialog" aria-modal="true" aria-label="Accesso richiesto">
            <form onSubmit={submit} style={styles.card}>
                <h3 style={styles.title}>Accesso richiesto</h3>
                <p style={styles.subtitle}>Inserisci la password per entrare nella piattaforma.</p>
                <input
                    type="password"
                    placeholder="Password"
                    value={pw}
                    onChange={(e) => { setPw(e.target.value); setErr(''); }}
                    style={styles.input}
                    autoFocus
                />
                {err && <div style={styles.error}>⚠️ {err}</div>}
                <button type="submit" style={styles.btn}>Entra</button>
            </form>
        </div>
    );
}

const styles = {
    backdrop: {
        position: 'fixed', inset: 0, zIndex: 1000,
        background: 'rgba(0,0,0,0.65)', display: 'grid', placeItems: 'center',
        backdropFilter: 'blur(2px)'
    },
    card: {
        width: 'min(420px, 92%)',
        background: 'linear-gradient(180deg, rgba(255,255,255,0.06), rgba(255,255,255,0.02))',
        border: '1px solid rgba(192,255,3,0.25)',
        borderRadius: '16px',
        boxShadow: '0 10px 30px rgba(0,0,0,0.35)',
        padding: '20px'
    },
    title: { margin: 0, color: 'var(--brand)', fontWeight: 900, letterSpacing: '.5px' },
    subtitle: { color: 'var(--fg)', opacity: .8, margin: '8px 0 14px' },
    input: {
        width: '100%', padding: '12px 14px', borderRadius: '10px',
        border: '1px solid var(--line)', background: 'var(--glass)', color: 'var(--fg)', outline: 'none'
    },
    error: {
        marginTop: 8, padding: '8px 10px', borderRadius: 8,
        border: '1px solid rgba(255,107,107,.4)', background: 'rgba(255,107,107,.1)', color: 'var(--error)'
    },
    btn: {
        marginTop: 12, width: '100%', padding: '12px 16px', borderRadius: '10px',
        border: 'none', cursor: 'pointer', fontWeight: 900, letterSpacing: '.5px',
        background: 'var(--brand)', color: '#0a0a0a'
    }
};
