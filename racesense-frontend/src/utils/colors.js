// src/utils/colors.js
// Generatore deterministico di colori a partire da una stringa (es. "Mario Rossi").
// Usa un PRNG seedato dall'hash del nome e restituisce un HEX pieno e leggibile.

// Hash veloce deterministico (xfnv1a)
function hashString(str) {
    let h = 2166136261 >>> 0;
    for (let i = 0; i < str.length; i++) {
        h ^= str.charCodeAt(i);
        h = Math.imul(h, 16777619);
    }
    return h >>> 0;
}

// PRNG semplice (mulberry32) da seed intero
function mulberry32(seed) {
    return function () {
        let t = (seed += 0x6D2B79F5) >>> 0;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

// HSL -> HEX
function hslToHex(h, s, l) {
    s /= 100;
    l /= 100;
    const k = n => (n + h / 30) % 12;
    const a = s * Math.min(l, 1 - l);
    const f = n => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
    const toHex = x => Math.round(x * 255).toString(16).padStart(2, '0');
    return `#${toHex(f(0))}${toHex(f(8))}${toHex(f(4))}`;
}

/**
 * Restituisce un colore HEX deterministico e “randomico”
 * basato su nome+cognome (case/whitespace-insensitive).
 *
 * Strategia:
 * - Hue da 0..360 “random” seedato.
 * - Saturation/Lightness fissate per buona leggibilità su sfondo scuro.
 * - Leggera variazione di L per distribuire meglio i toni simili.
 */
export function colorFromName(fullNameOrKey) {
    const key = String(fullNameOrKey || '').trim().toLowerCase().replace(/\s+/g, ' ');
    if (!key) return '#C0FF03'; // fallback

    const seed = hashString(key);
    const rand = mulberry32(seed);

    // Hue “random” su tutto il cerchio
    const hue = Math.floor(rand() * 360);

    // Saturazione alta per colori vividi, Lightness medio-alta per contrasto su asfalto grigio
    const sat = 72;

    // Lightness con piccola variazione deterministica per differenziare nomi simili
    const baseLight = 52;
    const jitter = Math.floor(rand() * 14) - 7; // [-7, +6]
    const light = Math.max(40, Math.min(62, baseLight + jitter));

    return hslToHex(hue, sat, light);
}
