#!/usr/bin/env python3
# simulator.py
#
# Simulatore di dispositivi GPS che inviano pacchetti UDP alla dashboard.
# Legge un file JSON di traccia (data/tracks/*.json), genera N dispositivi
# con MAC distinti e velocità differenti, e invia pacchetti nel formato:
#   MAC/LAT/LON/SATS/QUAL/SPEED_KMH/YYMMDDhhmmss[/CPUTEMP]
#
# Simula ritardi di rete 4G realistici con accodamento pacchetti.
#
# Uso:
#   python simulator.py --file data/tracks/<ID>.json --devices 5 --host 127.0.0.1 --port 8888
#
# Note:
# - Frequenza invio: ~15 Hz per dispositivo (configurabile)
# - Le posizioni sono interpolate lungo il tracciato in funzione della velocità
# - Ogni dispositivo segue una traiettoria fluida e unica generata con Perlin noise
# - Simula ritardi di rete casuali (0-800ms) con spike occasionali (fino a 2s)

import argparse
import json
import math
import random
import socket
import string
import sys
import time
import heapq
from datetime import datetime, timezone
from collections import deque

# ---------- Geodesia ----------
R_EARTH = 6371000.0  # m

def to_rad(d): 
    return d * math.pi / 180.0

def to_deg(r): 
    return r * 180.0 / math.pi

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
        self.grid_size = 100.0
        self.values = {}
    
    def _get_grid_value(self, grid_x):
        """Ottiene o genera un valore random per un punto griglia."""
        if grid_x not in self.values:
            random.seed(self.seed + grid_x * 12345)
            self.values[grid_x] = random.uniform(-1, 1)
        return self.values[grid_x]
    
    def _smoothstep(self, t):
        """Interpolazione smooth (Hermite)."""
        return t * t * (3 - 2 * t)
    
    def noise(self, x):
        """Genera valore noise fluido per posizione x."""
        grid_x0 = math.floor(x / self.grid_size)
        grid_x1 = grid_x0 + 1
        
        v0 = self._get_grid_value(grid_x0)
        v1 = self._get_grid_value(grid_x1)
        
        local_x = (x - grid_x0 * self.grid_size) / self.grid_size
        t = self._smoothstep(local_x)
        
        return v0 * (1 - t) + v1 * t

class TrajectoryGenerator:
    """Genera offset fluidi dalla linea centrale del tracciato."""
    
    def __init__(self, seed, max_offset_m=5.0, frequency=50.0):
        self.noise_lat = SimplexNoiseGenerator(seed)
        self.noise_lon = SimplexNoiseGenerator(seed + 999999)
        self.max_offset = max_offset_m
        self.frequency = frequency
    
    def get_offset(self, distance_m):
        """Calcola offset lat/lon in metri per una data distanza sul tracciato."""
        x = distance_m / self.frequency
        offset_lat = self.noise_lat.noise(x) * self.max_offset
        offset_lon = self.noise_lon.noise(x) * self.max_offset
        return offset_lat, offset_lon

# ---------- Simulatore Ritardi di Rete ----------
# Modifica la classe NetworkDelaySimulator - circa riga 120

class NetworkDelaySimulator:
    """
    Simula ritardi 4G realistici per ciascun dispositivo:
    - jitter base + spike
    - blackout per-MAC (accumulo e flush in burst)
    - perdita parziale opzionale durante blackout
    """
    def __init__(self,
                 base_delay_ms=10,
                 max_delay_ms=150,
                 spike_prob=0.02,
                 spike_delay_ms=800,
                 blackout_prob_per_sec=0.02,          # probabilità al secondo di entrare in blackout
                 blackout_min_ms=400,
                 blackout_max_ms=1600,
                 blackout_buffer_mode="buffer",       # "buffer" | "drop"
                 blackout_drop_ratio=0.0,             # 0..1 se mode="drop"
                 flush_compaction_ms=8):               # spacing durante flush (rilascio rapido)
        self.base_delay = base_delay_ms / 1000.0
        self.max_delay = max_delay_ms / 1000.0
        self.spike_prob = spike_prob
        self.spike_delay = spike_delay_ms / 1000.0

        # Blackout per-device
        self.blackout_prob_per_sec = blackout_prob_per_sec
        self.blackout_min = blackout_min_ms / 1000.0
        self.blackout_max = blackout_max_ms / 1000.0
        self.blackout_mode = blackout_buffer_mode
        self.blackout_drop_ratio = blackout_drop_ratio
        self.flush_compaction = flush_compaction_ms / 1000.0

        # Coda per ciascun dispositivo: heap di (send_time, ts_gps, payload)
        self.queues = {}
        # Stato per ciascun MAC
        # mac -> { blackout_until: float|0, in_blackout: bool, next_flush_time: float }
        self.state = {}

        # Stats
        self.stats = {
            'packets_queued': 0,
            'packets_sent': 0,
            'current_queue_size': 0,
            'max_queue_size': 0,
            'spikes_triggered': 0,
            'blackouts_started': 0,
            'blackouts_dropped': 0
        }

        self._last_tick = time.perf_counter()

    def _maybe_start_blackout(self, mac, now):
        st = self.state.setdefault(mac, {'blackout_until': 0.0, 'in_blackout': False, 'next_flush_time': 0.0})
        # chance per secondo → per tick stimiamo dt e applichiamo Bernoulli con p = prob_per_sec * dt
        dt = max(0.0, now - self._last_tick)
        p = self.blackout_prob_per_sec * dt
        if not st['in_blackout'] and random.random() < p:
            dur = random.uniform(self.blackout_min, self.blackout_max)
            st['blackout_until'] = now + dur
            st['in_blackout'] = True
            self.stats['blackouts_started'] += 1

    def _update_blackout_state(self, mac, now):
        st = self.state.setdefault(mac, {'blackout_until': 0.0, 'in_blackout': False, 'next_flush_time': 0.0})
        if st['in_blackout'] and now >= st['blackout_until']:
            st['in_blackout'] = False
            # quando torna rete, iniziamo a flushare con spacing compattato
            st['next_flush_time'] = now

    def _get_delay_normal(self):
        delay = self.base_delay + random.uniform(0, max(0.0, self.max_delay - self.base_delay))
        if random.random() < self.spike_prob:
            delay += random.uniform(0, self.spike_delay)
            self.stats['spikes_triggered'] += 1
        return delay

    def enqueue_packet(self, mac, timestamp_gps, payload):
        now = time.perf_counter()
        self._maybe_start_blackout(mac, now)
        self._update_blackout_state(mac, now)

        q = self.queues.setdefault(mac, [])
        st = self.state.setdefault(mac, {'blackout_until': 0.0, 'in_blackout': False, 'next_flush_time': 0.0})

        if st['in_blackout']:
            if self.blackout_mode == "drop":
                # Perdita parziale durante blackout
                if random.random() < self.blackout_drop_ratio:
                    self.stats['blackouts_dropped'] += 1
                    return
                # Altrimenti bufferiamo comunque (come se il device accodasse localmente)
            # BUFFER: schedula invio DOPO la fine del blackout, compattato
            # Imposta un "send_time" a partire da next_flush_time e incrementa di flush_compaction
            send_time = max(st['blackout_until'], st['next_flush_time'])
            st['next_flush_time'] = send_time + self.flush_compaction
        else:
            # stato normale: jitter + spike
            send_time = now + self._get_delay_normal()

        # Mantieni l'ordine per MAC tramite heap sul send_time
        heapq.heappush(q, (send_time, timestamp_gps, payload))
        self.stats['packets_queued'] += 1

        # update queue stats
        total = sum(len(qq) for qq in self.queues.values())
        self.stats['current_queue_size'] = total
        self.stats['max_queue_size'] = max(self.stats['max_queue_size'], total)

        self._last_tick = now

    def send_ready_packets(self, sock, addr):
        now = time.perf_counter()
        sent = 0
        for mac, q in self.queues.items():
            # invia tutti i pacchetti maturi per questo MAC
            while q and q[0][0] <= now:
                _, _, payload = heapq.heappop(q)
                try:
                    sock.sendto(payload, addr)
                    sent += 1
                    self.stats['packets_sent'] += 1
                except Exception as e:
                    print(f"[NET] Errore invio pacchetto: {e}")
        self.stats['current_queue_size'] = sum(len(qq) for qq in self.queues.values())
        return sent

    def get_stats(self):
        return self.stats.copy()

# ---------- Utilità ----------
HEX = '0123456789ABCDEF'

# Sostituisci la funzione ts_yyMMddHHmmss_now() - circa riga 190

def ts_yyMMddHHmmss_from_time(t=None):
    """Genera timestamp GPS dal tempo Unix fornito (o now se None)."""
    if t is None:
        dt = datetime.now(timezone.utc)
    else:
        dt = datetime.fromtimestamp(t, tz=timezone.utc)
    return dt.strftime('%y%m%d%H%M%S')

def random_mac():
    first = random.choice(['0','2','4','6','8','A','C','E'])
    mac = first + random.choice(HEX)
    for _ in range(5):
        mac += ''.join(random.choice(HEX) for _ in range(2))
    return mac.upper()

def ts_yyMMddHHmmss_now():
    """Genera timestamp GPS nel formato YYMMDDhhmmss (UTC)."""
    dt = datetime.now(timezone.utc)
    return dt.strftime('%y%m%d%H%M%S')

def load_track_points(path):
    with open(path, 'r', encoding='utf-8') as f:
        data = json.load(f)
    pts = data.get('pathPoints') or []
    if not pts:
        raise ValueError('Il file non contiene pathPoints.')
    
    out = []
    for p in pts:
        try:
            lat = float(p['lat'])
            lon = float(p['lon'])
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
    i = min(len(cumdist) - 1, max(1, int((s / cumdist[-1]) * (len(cumdist) - 1))))
    
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
        self.s = start_s
        self.cpu_temp = cpu_temp
        self.trajectory_gen = trajectory_gen
    
    @property
    def speed_mps(self):
        return self.speed_kmh * 1000.0 / 3600.0

def run_simulation(track_file, n_devices, host, port,
                   min_kmh, max_kmh, jitter_speed=0.5, hz=15.0, loop=True,
                   max_offset=5.0, offset_frequency=50.0,
                   base_delay_ms=50, max_delay_ms=800, 
                   spike_prob=0.03, spike_delay_ms=2000):
    
    points = load_track_points(track_file)
    cum = cumulative_distances(points)
    total_len = cum[-1]
    
    if total_len <= 0:
        raise ValueError("Lunghezza tracciato non valida.")
    
    # UDP socket
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    addr = (host, port)
    
    # Simulatore ritardi di rete
    net_sim = NetworkDelaySimulator(base_delay_ms, max_delay_ms, spike_prob, spike_delay_ms)
    
    # Crea dispositivi
    devices = []
    base_quals = [4,5,6,7,8,9]
    
    for i in range(n_devices):
        mac = random_mac()
        speed = random.uniform(min_kmh, max_kmh)
        start_s = random.uniform(0, total_len)
        sats = random.randint(10, 20)
        qual = random.choice(base_quals)
        cpu_temp = round(random.uniform(40.0, 75.0), 1)
        
        seed = random.randint(0, 1000000)
        trajectory_gen = TrajectoryGenerator(seed, max_offset, offset_frequency)
        
        devices.append(Device(mac, speed, start_s, sats, qual, trajectory_gen, cpu_temp))
    
    print(f"[SIM] Tracciato: {track_file}")
    print(f"[SIM] Lunghezza: {total_len:.1f} m, punti: {len(points)}")
    print(f"[SIM] Dispositivi: {len(devices)} | Frequenza: {hz:.1f} Hz | {host}:{port}")
    print(f"[SIM] Offset traiettoria: {max_offset:.1f} m | Frequenza variazione: {offset_frequency:.1f} m")
    print(f"[SIM] Ritardi rete: base={base_delay_ms}ms, max={max_delay_ms}ms")
    print(f"[SIM] Spike probabilità: {spike_prob*100:.1f}% | Spike ritardo: {spike_delay_ms}ms")
    print(f"[SIM] Premi Ctrl+C per terminare\n")
    
    dt = 1.0 / hz
    last_tick = time.perf_counter()
    last_stats_print = time.perf_counter()
    
    try:
        while True:
            now = time.perf_counter()
            elapsed = now - last_tick
            
            # Controllo timing per mantenere frequenza costante
            if elapsed < dt:
                time.sleep(dt - elapsed)
                now = time.perf_counter()
                elapsed = now - last_tick
            
            last_tick = now
            
            # ========== FASE 1: GENERA PACCHETTI GPS ==========
            # Ogni dispositivo "legge" la sua posizione GPS con timestamp corrente
            gps_read_time = time.time()  # Tempo Unix corrente (secondi)
            
            for d in devices:
                # Variabilità velocità
                speed_kmh_inst = max(0.0, d.speed_kmh + random.uniform(-jitter_speed, jitter_speed))
                
                # Avanza lungo il tracciato
                d.s += (speed_kmh_inst * 1000.0 / 3600.0) * elapsed
                if d.s >= total_len:
                    if loop:
                        d.s %= total_len
                    else:
                        d.s = total_len - 1e-6
                
                # Posizione base sul tracciato
                base_lat, base_lon = interpolate_on_path(points, cum, d.s)
                
                # Offset fluido per traiettoria unica
                offset_lat_m, offset_lon_m = d.trajectory_gen.get_offset(d.s)
                dlat, dlon = meters_to_latlon_offset(base_lat, offset_lat_m, offset_lon_m)
                
                lat = base_lat + dlat
                lon = base_lon + dlon
                
                # 🔴 CRITICO: Timestamp GPS dal momento di lettura (NON dal momento di invio)
                # Simula che il Raspberry abbia letto il GPS in questo preciso istante
                # Il ritardo di rete NON influenza questo timestamp
                timestamp_gps = ts_yyMMddHHmmss_from_time(gps_read_time)
                ms = int((gps_read_time - int(gps_read_time)) * 1000)
                
                # Costruisci payload (formato server.js)
                line = f"{d.mac}/{lat:+.7f}/{lon:+.7f}/{d.sats}/{d.qual}/{speed_kmh_inst:.1f}/{timestamp_gps}/{ms}/{d.cpu_temp:.1f}"
                # print(line)
                payload = line.encode('utf-8')
                
                # 🔴 ACCODA con ritardo (simula SOLO latenza rete 4G)
                # Il timestamp GPS rimane quello di "gps_read_time", 
                # ma il pacchetto arriverà al server dopo il delay
                net_sim.enqueue_packet(d.mac, timestamp_gps, payload)
            
            # ========== FASE 2: INVIA PACCHETTI MATURI ==========
            # Invia tutti i pacchetti il cui "tempo di invio" è scaduto
            net_sim.send_ready_packets(sock, addr)
            
            # ========== FASE 3: STATISTICHE (ogni 5 secondi) ==========
            if now - last_stats_print >= 5.0:
                stats = net_sim.get_stats()
                print(f"[STATS] Queue: {stats['current_queue_size']}/{stats['max_queue_size']} | "
                      f"Sent: {stats['packets_sent']} | Spikes: {stats['spikes_triggered']}")
                last_stats_print = now
    
    except KeyboardInterrupt:
        print("\n[SIM] Interruzione utente...")
        
        # Flush finale: invia tutti i pacchetti rimasti
        print("[SIM] Flush pacchetti in coda...")
        deadline = time.perf_counter() + 5.0  # max 5s di attesa
        
        while time.perf_counter() < deadline:
            remaining = sum(len(q) for q in net_sim.queues.values())
            if remaining == 0:
                break
            net_sim.send_ready_packets(sock, addr)
            time.sleep(0.01)
        
        final_stats = net_sim.get_stats()
        remaining = sum(len(q) for q in net_sim.queues.values())
        
        print(f"\n[STATS FINALI]")
        print(f"  Pacchetti accodati: {final_stats['packets_queued']}")
        print(f"  Pacchetti inviati:  {final_stats['packets_sent']}")
        print(f"  Rimasti in coda:    {remaining}")
        print(f"  Spike attivati:     {final_stats['spikes_triggered']}")
        print(f"  Coda max:           {final_stats['max_queue_size']}")
    
    finally:
        sock.close()
        print("[SIM] Terminato.")

def main():
    ap = argparse.ArgumentParser(
        description="Simulatore GPS con ritardi di rete 4G realistici",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Esempi d'uso:

  # Simulazione normale (15 Hz, ritardi moderati)
  python3 tracksimulator.py --file data/circuiti/2025-10-23T13-39-40-000Z__tracciato-ferrara-gara.json --devices 20 --hz 15

  # Rete 4G problematica (ritardi alti, spike frequenti)
  python3 tracksimulator.py --file data/circuiti/2025-10-23T13-39-40-000Z__tracciato-ferrara-gara.json --devices 20 \\
      --max-delay-ms 1500 --spike-prob 0.05 --spike-delay-ms 3000

  # Rete ottima (ritardi minimi)
  python3 tracksimulator.py --file data/circuiti/2025-10-23T13-39-40-000Z__tracciato-ferrara-gara.json --devices 20 \\
      --base-delay-ms 20 --max-delay-ms 100 --spike-prob 0.01
        """
    )
    
    # Parametri base
    ap.add_argument('--file', required=True, 
                    help='File JSON del tracciato')
    ap.add_argument('--devices', type=int, default=5, 
                    help='Numero dispositivi (default: 5)')
    ap.add_argument('--host', default='127.0.0.1', 
                    help='Host server (default: 127.0.0.1)')
    ap.add_argument('--port', type=int, default=8888, 
                    help='Porta UDP (default: 8888)')
    
    # Parametri velocità
    ap.add_argument('--min-speed', type=float, default=30.0, 
                    help='Velocità minima km/h (default: 30)')
    ap.add_argument('--max-speed', type=float, default=60.0, 
                    help='Velocità massima km/h (default: 60)')
    ap.add_argument('--hz', type=float, default=15.0, 
                    help='Frequenza invio Hz (default: 15)')
    
    # Parametri traiettoria
    ap.add_argument('--no-loop', action='store_true', 
                    help='Non loop sul tracciato')
    ap.add_argument('--max-offset', type=float, default=5.0, 
                    help='Offset max traiettoria metri (default: 5.0)')
    ap.add_argument('--offset-freq', type=float, default=50.0, 
                    help='Frequenza variazione traiettoria metri (default: 50.0)')
    
    # Parametri ritardi di rete
    ap.add_argument('--base-delay-ms', type=int, default=50, 
                    help='Ritardo base rete ms (default: 10)')
    ap.add_argument('--max-delay-ms', type=int, default=250, 
                    help='Ritardo massimo rete ms (default: 150)')
    ap.add_argument('--spike-prob', type=float, default=0.04, 
                    help='Probabilità spike ritardo 0-1 (default: 0.02)')
    ap.add_argument('--spike-delay-ms', type=int, default=1000, 
                    help='Ritardo spike ms (default: 800)')    
    args = ap.parse_args()
    
    # Validazione
    if args.devices <= 0:
        print("❌ Numero dispositivi deve essere > 0", file=sys.stderr)
        sys.exit(2)
    
    if args.min_speed <= 0 or args.max_speed <= 0 or args.max_speed < args.min_speed:
        print("❌ Intervallo velocità non valido", file=sys.stderr)
        sys.exit(2)
    
    if args.base_delay_ms < 0 or args.max_delay_ms < args.base_delay_ms:
        print("❌ Ritardi non validi (base <= max)", file=sys.stderr)
        sys.exit(2)
    
    if not (0.0 <= args.spike_prob <= 1.0):
        print("❌ spike-prob deve essere tra 0.0 e 1.0", file=sys.stderr)
        sys.exit(2)
    
    # Esegui simulazione
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
        offset_frequency=args.offset_freq,
        base_delay_ms=args.base_delay_ms,
        max_delay_ms=args.max_delay_ms,
        spike_prob=args.spike_prob,
        spike_delay_ms=args.spike_delay_ms
    )

if __name__ == '__main__':
    main()