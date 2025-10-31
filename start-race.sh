#!/bin/bash

# Script per avviare RACESENSE Race Live
# Uso: ./start-race.sh

echo "🏎️  RACESENSE - Avvio sistema Race Live"
echo "========================================"

# Colori
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Check se siamo nella directory corretta
if [ ! -d "racesense-backend" ] || [ ! -d "racesense-frontend" ]; then
    echo -e "${RED}❌ Errore: esegui questo script dalla root di racesense${NC}"
    exit 1
fi

echo -e "\n${YELLOW}📦 1/3 - Avvio Backend (HTTP + WebSocket + UDP)...${NC}"
cd racesense-backend
npm start &
BACKEND_PID=$!
echo -e "${GREEN}✅ Backend avviato (PID: $BACKEND_PID)${NC}"
sleep 2

echo -e "\n${YELLOW}📦 2/3 - Avvio Frontend React...${NC}"
cd ../racesense-frontend
npm start &
FRONTEND_PID=$!
echo -e "${GREEN}✅ Frontend avviato (PID: $FRONTEND_PID)${NC}"
sleep 3

echo -e "\n${YELLOW}🚗 3/3 - Avvio Simulatore GPS (5 piloti su Ferrara)...${NC}"
cd ../racesense-backend
python3 tracksimualtor.py \
  --file data/circuiti/2025-10-23T13-39-40-000Z__tracciato-ferrara-gara.json \
  --devices 5 \
  --min-speed 30 \
  --max-speed 70 \
  --hz 15 &
SIMULATOR_PID=$!
echo -e "${GREEN}✅ Simulatore avviato (PID: $SIMULATOR_PID)${NC}"

echo -e "\n${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${GREEN}🏁 Sistema Race Live ATTIVO!${NC}"
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""
echo -e "📊 Backend API:     ${YELLOW}http://localhost:5000${NC}"
echo -e "🌐 Frontend:        ${YELLOW}http://localhost:3000${NC}"
echo -e "🔌 WebSocket:       ${YELLOW}ws://localhost:5001${NC}"
echo -e "📡 UDP GPS:         ${YELLOW}127.0.0.1:8888${NC}"
echo ""
echo -e "🎮 ${YELLOW}Vai su http://localhost:3000/race${NC}"
echo ""
echo -e "${RED}⏹️  Per fermare: Ctrl+C${NC}"

# Cleanup su interrupt
trap "echo -e '\n${RED}🛑 Arresto servizi...${NC}'; kill $BACKEND_PID $FRONTEND_PID $SIMULATOR_PID 2>/dev/null; exit" INT

# Mantieni script attivo
wait
