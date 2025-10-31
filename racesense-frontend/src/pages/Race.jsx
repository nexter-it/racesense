import React, { useState } from 'react';
import RaceSetup from './RaceSetup';
// Mantieni RaceLive se lo usi già nel progetto (stile gestito internamente oppure in futuro lo porteremo su App.css)
import RaceLive from './RaceLive';

// Importa App.css a livello globale se non è già caricato in index.js
import '../App.css';

export default function RacePage() {
  const [raceConfig, setRaceConfig] = useState(null);
  const [raceActive, setRaceActive] = useState(false);

  const handleStartRace = (config) => {
    console.log('[Race] Configurazione ricevuta:', config);
    setRaceConfig(config);
    setRaceActive(true);
  };

  const handleStopRace = () => {
    setRaceActive(false);
    setRaceConfig(null);
  };

  if (!raceActive || !raceConfig) {
    // Schermata di setup in stile App.css
    return <RaceSetup onStartRace={handleStartRace} />;
  }

  // Vista live (lasciata com’è; se vuoi, la portiamo allo stesso stile in un secondo step)
  return <RaceLive raceConfig={raceConfig} onStopRace={handleStopRace} />;
}
