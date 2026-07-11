import { initAuth } from './auth.js';
import { initFeriaSelector } from './ferias.js';
import { initFeriaView } from './nav.js';
import { initReporteGeneral } from './reporte-general.js';

function showFeriaSelector() {
  document.getElementById('feria-view').classList.add('hidden');
  document.getElementById('reporte-general').classList.add('hidden');
  initFeriaSelector((feria) => {
    initFeriaView(feria, { onExit: showFeriaSelector });
  });
}

document.getElementById('btn-reporte-general').addEventListener('click', () => {
  document.getElementById('feria-selector').classList.add('hidden');
  initReporteGeneral({ onVolver: showFeriaSelector });
});

initAuth(showFeriaSelector);
