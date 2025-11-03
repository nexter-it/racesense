#!/usr/bin/env python3
# simulator.py
#
# Simulatore di dispositivi GPS che inviano pacchetti UDP alla dashboard.
# Legge un file JSON di traccia (data/tracks/*.json), genera N dispositivi
# con MAC distinti e velocità differenti, e invia pacchetti nel formato:
#   MAC/LAT/LON/SATS/QUAL/SPEED_KMH/YYMMDDhhmmss[/CPUTEMP]
#
# Uso:
#   python simulator.py --file data/tracks/<ID>.json --devices 5 --host 127.0.0.1 --port 8888

#
# Note:
# - Frequenza invio: ~5 Hz per dispositivo
# - Le posizioni sono interpolate lungo il tracciato in funzione della velocità
# - Ogni dispositivo segue una traiettoria fluida e unica generata con Perlin noise

import argparse
import json
import math
import random
import socket
import string
import sys
import time
from datetime import datetime, timezone

# ---------- Geodesia ----------
R_EARTH = 6371000.0  # m

def to_rad(d): return d * math.pi / 180.0
def to_deg(r): return r * 180.0 / math.pi

def haversine_m(lat1, lon1, lat2, lon2):
    phi1, phi2 = to_rad(lat1), to_rad(lat2)
    dphi = to_rad(lat2 - lat1)
    dlmb = to_rad(lon2 - lon1)
    a = math.sin(dphi/2)**2 + math.cos(phi1)*math.cos(phi2)*math.sin(dlmb/2)**2
    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))
    return R_EARTH * c

def slerp_latlon(lat1, lon1, lat2, lon2, t):
    """Interpolazione sferica fra due coordinate (0<=t<=1)."""
    phi1, lmb1 = to_rad(lat1), to_rad(lon1)
    phi2, lmb2 = to_rad(lat2), to_rad(lon2)
    delta = 2 * math.asin(math.sqrt(
        math.sin((phi2 - phi1)/2)**2 + math.cos(phi1)*math.cos(phi2)*math.sin((lmb2 - lmb1)/2)**2
    ))
    if delta == 0:
        return lat1, lon1
    A = math.sin((1 - t) * delta) / math.sin(delta)
    B = math.sin(t * delta) / math.sin(delta)
    x = A * math.cos(phi1) * math.cos(lmb1) + B * math.cos(phi2) * math.cos(lmb2)
    y = A * math.cos(phi1) * math.sin(lmb1) + B * math.cos(phi2) * math.sin(lmb2)
    z = A * math.sin(phi1) + B * math.sin(phi2)
    phi = math.atan2(z, math.sqrt(x*x + y*y))
    lmb = math.atan2(y, x)
    return to_deg(phi), to_deg(lmb)

def meters_to_latlon_offset(lat, meters_lat, meters_lon):
    """Converte offset in metri a offset in gradi lat/lon."""
    dlat = meters_lat / R_EARTH * 180.0 / math.pi
    dlon = meters_lon / (R_EARTH * math.cos(to_rad(lat))) * 180.0 / math.pi
    return dlat, dlon

# ---------- Perlin-like Noise per traiettorie fluide ----------
class SimplexNoiseGenerator:
    """Generatore di noise 1D basato su interpolazione smooth per creare offset fluidi."""
    
    def __init__(self, seed=None):
        self.seed = seed if seed is not None else random.randint(0, 1000000)
        random.seed(self.seed)
        # Pre-genera valori random ad intervalli regolari
        self.grid_size = 100.0  # distanza tra i punti di controllo
        self.values = {}
    
    def _get_grid_value(self, grid_x):
        """Ottiene o genera un valore random per un punto griglia."""
        if grid_x not in self.values:
            # Usa hash deterministico basato su posizione e seed
            random.seed(self.seed + grid_x * 12345)
            self.values[grid_x] = random.uniform(-1, 1)
        return self.values[grid_x]
    
    def _smoothstep(self, t):
        """Interpolazione smooth (Hermite)."""
        return t * t * (3 - 2 * t)
    
    def noise(self, x):
        """Genera valore noise fluido per posizione x."""
        # Trova i punti griglia adiacenti
        grid_x0 = math.floor(x / self.grid_size)
        grid_x1 = grid_x0 + 1
        
        # Ottieni valori ai punti griglia
        v0 = self._get_grid_value(grid_x0)
        v1 = self._get_grid_value(grid_x1)
        
        # Interpola smoothmente
        local_x = (x - grid_x0 * self.grid_size) / self.grid_size
        t = self._smoothstep(local_x)
        
        return v0 * (1 - t) + v1 * t

class TrajectoryGenerator:
    """Genera offset fluidi dalla linea centrale del tracciato."""
    
    def __init__(self, seed, max_offset_m=5.0, frequency=50.0):
        """
        seed: seed univoco per questo dispositivo
        max_offset_m: offset massimo in metri dalla linea centrale
        frequency: frequenza del noise (metri) - valori più bassi = curve più ampie
        """
        self.noise_lat = SimplexNoiseGenerator(seed)
        self.noise_lon = SimplexNoiseGenerator(seed + 999999)
        self.max_offset = max_offset_m
        self.frequency = frequency
    
    def get_offset(self, distance_m):
        """Calcola offset lat/lon in metri per una data distanza sul tracciato."""
        # Genera offset usando noise a frequenza controllata
        x = distance_m / self.frequency
        offset_lat = self.noise_lat.noise(x) * self.max_offset
        offset_lon = self.noise_lon.noise(x) * self.max_offset
        return offset_lat, offset_lon

# ---------- Utilità ----------
HEX = '0123456789ABCDEF'
def random_mac():
    # Prima coppia pari (unicast, globally unique) – opzionale
    first = random.choice(['0','2','4','6','8','A','C','E'])
    mac = first + random.choice(HEX)
    for _ in range(5):
        mac += ''.join(random.choice(HEX) for _ in range(2))
    return mac.upper()

def ts_yyMMddHHmmss_now():
    dt = datetime.now(timezone.utc)
    return dt.strftime('%y%m%d%H%M%S')

def load_track_points(path):
    with open(path, 'r', encoding='utf-8') as f:
        data = json.load(f)
    pts = data.get('pathPoints') or []
    if not pts:
        raise ValueError('Il file non contiene pathPoints.')
    # Normalizza e filtra eventuali record malformati
    out = []
    for p in pts:
        try:
            lat = float(p['lat']); lon = float(p['lon'])
            out.append((lat, lon))
        except Exception:
            continue
    if len(out) < 2:
        raise ValueError('Sono necessari almeno 2 punti per simulare il tracciato.')
    return out

def cumulative_distances(points):
    """Restituisce una lista cumdist (m) parallela a points."""
    cum = [0.0]
    for i in range(1, len(points)):
        d = haversine_m(points[i-1][0], points[i-1][1], points[i][0], points[i][1])
        cum.append(cum[-1] + max(0.0, d))
    return cum

def interpolate_on_path(points, cumdist, s):
    """Intercetta lat/lon alla distanza progressiva s (m) lungo il path."""
    # Assumi s in [0, total_len)
    # Trova segmento [i-1, i] che contiene s
    lo, hi = 1, len(cumdist) - 1
    # Ricerca binaria semplificata
    i = min(len(cumdist) - 1, max(1, int((s / cumdist[-1]) * (len(cumdist) - 1))))
    # Regola localmente
    if cumdist[i] < s:
        while i < len(cumdist)-1 and cumdist[i] < s:
            i += 1
    else:
        while i > 1 and cumdist[i-1] > s:
            i -= 1
    s0, s1 = cumdist[i-1], cumdist[i]
    if s1 == s0:
        return points[i]
    t = (s - s0) / (s1 - s0)
    lat, lon = slerp_latlon(points[i-1][0], points[i-1][1], points[i][0], points[i][1], t)
    return lat, lon

# ---------- Simulatore ----------
class Device:
    def __init__(self, mac, speed_kmh, start_s, sats, qual, trajectory_gen, cpu_temp=None):
        self.mac = mac
        self.speed_kmh = speed_kmh
        self.sats = sats
        self.qual = qual
        self.s = start_s  # distanza progressiva (m) lungo il path
        self.cpu_temp = cpu_temp
        self.trajectory_gen = trajectory_gen

    @property
    def speed_mps(self):
        return self.speed_kmh * 1000.0 / 3600.0

def run_simulation(track_file, n_devices, host, port,
                   min_kmh, max_kmh, jitter_speed=0.5, hz=5.0, loop=True,
                   max_offset=5.0, offset_frequency=50.0):
    points = load_track_points(track_file)
    cum = cumulative_distances(points)
    total_len = cum[-1]
    if total_len <= 0:
        raise ValueError("Lunghezza tracciato non valida.")

    # UDP socket
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    addr = (host, port)

    # Crea dispositivi con velocità diverse, offset lungo il percorso e traiettorie uniche
    devices = []
    base_quals = [4,5,6,7,8,9]
    for i in range(n_devices):
        mac = random_mac()
        speed = random.uniform(min_kmh, max_kmh)  # km/h
        start_s = random.uniform(0, total_len)    # offset casuale sul circuito
        sats = random.randint(10, 20)
        qual = random.choice(base_quals)
        cpu_temp = round(random.uniform(40.0, 75.0), 1)
        
        # Crea generatore di traiettoria unico per questo dispositivo
        seed = random.randint(0, 1000000)
        trajectory_gen = TrajectoryGenerator(seed, max_offset, offset_frequency)
        
        devices.append(Device(mac, speed, start_s, sats, qual, trajectory_gen, cpu_temp))

    print(f"[SIM] Tracciato: {track_file}")
    print(f"[SIM] Lunghezza stimata: {total_len:.1f} m, punti: {len(points)}")
    print(f"[SIM] Dispositivi: {len(devices)}  |  Frequenza: {hz:.1f} Hz  |  Destinazione: {host}:{port}")
    print(f"[SIM] Offset max traiettoria: {max_offset:.1f} m  |  Frequenza variazione: {offset_frequency:.1f} m")

    dt = 1.0 / hz
    last = time.perf_counter()

    try:
        while True:
            now = time.perf_counter()
            elapsed = now - last
            if elapsed < dt:
                time.sleep(dt - elapsed)
                now = time.perf_counter()
                elapsed = now - last
            last = now

            # per ogni tick invia il pacchetto di ciascun device
            for d in devices:
                # piccola variabilità di velocità per renderla "viva"
                speed_kmh_inst = max(0.0, d.speed_kmh + random.uniform(-jitter_speed, jitter_speed))
                d.s += (speed_kmh_inst * 1000.0 / 3600.0) * elapsed
                if d.s >= total_len:
                    if loop:
                        d.s %= total_len
                    else:
                        d.s = total_len - 1e-6

                # Ottieni posizione base sul tracciato
                base_lat, base_lon = interpolate_on_path(points, cum, d.s)
                
                # Applica offset fluido per creare traiettoria unica
                offset_lat_m, offset_lon_m = d.trajectory_gen.get_offset(d.s)
                dlat, dlon = meters_to_latlon_offset(base_lat, offset_lat_m, offset_lon_m)
                
                lat = base_lat + dlat
                lon = base_lon + dlon

                # Timestamp YYMMDDhhmmss (UTC)
                ts = ts_yyMMddHHmmss_now()

                # Formattazione coerente con server.js (7 decimali su lat/lon)
                line = f"{d.mac}/{lat:+.7f}/{lon:+.7f}/{d.sats}/{d.qual}/{speed_kmh_inst:.1f}/{ts}/{d.cpu_temp:.1f}"
                sock.sendto(line.encode('utf-8'), addr)

            # opzionale: stampa heartbeat
            # print(f"[SIM] tick sent ({len(devices)} packets)")
    except KeyboardInterrupt:
        print("\n[SIM] Interrotto dall'utente.")
    finally:
        sock.close()

def main():
    ap = argparse.ArgumentParser(description="Simulatore dispositivi GPS per dashboard (UDP).")
    ap.add_argument('--file', required=True, help='Percorso al file JSON del tracciato (es: data/tracks/<ID>.json)')
    ap.add_argument('--devices', type=int, default=5, help='Numero dispositivi da simulare (default: 5)')
    ap.add_argument('--host', default='127.0.0.1', help='Host UDP della piattaforma (default: 127.0.0.1)')
    ap.add_argument('--port', type=int, default=8888, help='Porta UDP (default: 8888)')
    ap.add_argument('--min-speed', type=float, default=10.0, help='Velocità minima (km/h) (default: 10)')
    ap.add_argument('--max-speed', type=float, default=40.0, help='Velocità massima (km/h) (default: 40)')
    ap.add_argument('--hz', type=float, default=15.0, help='Frequenza invio per dispositivo (Hz) (default: 15)')
    ap.add_argument('--no-loop', action='store_true', help='Non ricircolare sul tracciato (si ferma allultimo punto)')
    ap.add_argument('--max-offset', type=float, default=5.0, help='Offset massimo dalla linea centrale (m) (default: 5.0)')
    ap.add_argument('--offset-freq', type=float, default=50.0, help='Frequenza variazione traiettoria (m) - valori più bassi = curve più ampie (default: 50.0)')
    args = ap.parse_args()

    if args.devices <= 0:
        print("Numero dispositivi non valido.", file=sys.stderr)
        sys.exit(2)
    if args.min_speed <= 0 or args.max_speed <= 0 or args.max_speed < args.min_speed:
        print("Intervallo velocità non valido.", file=sys.stderr)
        sys.exit(2)

    run_simulation(
        track_file=args.file,
        n_devices=args.devices,
        host=args.host,
        port=args.port,
        min_kmh=args.min_speed,
        max_kmh=args.max_speed,
        hz=args.hz,
        loop=not args.no_loop,
        max_offset=args.max_offset,
        offset_frequency=args.offset_freq
    )

if __name__ == '__main__':
    main()