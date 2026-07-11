import { initAuth } from './auth.js';
import { initFeriaSelector } from './ferias.js';
import { initFeriaView } from './nav.js';

function showFeriaSelector() {
  document.getElementById('feria-view').classList.add('hidden');
  initFeriaSelector((feria) => {
    initFeriaView(feria, { onExit: showFeriaSelector });
  });
}

initAuth(showFeriaSelector);
