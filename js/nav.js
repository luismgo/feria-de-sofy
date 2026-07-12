import { initVender } from './vender.js';
import { initInventario } from './inventario.js';
import { initIdeas } from './ideas.js';
import { initReportes } from './reportes.js';

const TABS = ['vender', 'inventario', 'ideas', 'reportes'];
const INIT_FNS = { vender: initVender, inventario: initInventario, ideas: initIdeas, reportes: initReportes };

let currentFeria = null;
let currentCleanups = {};
let tabButtonsBound = false;

function clearTab(tab) {
  if (currentCleanups[tab]) {
    currentCleanups[tab]();
    currentCleanups[tab] = null;
  }
  document.getElementById(`tab-${tab}`).innerHTML = '';
}

function showTab(tab) {
  TABS.forEach((t) => {
    document.getElementById(`tab-${t}`).classList.toggle('hidden', t !== tab);
  });
  document.querySelectorAll('.tab-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.tab === tab);
  });
  // Reportes es una vista de solo lectura (arqueo / cerrar caja): tiene que re-fetchear
  // cada vez que se entra, o "Cerrar caja" mostraría totales viejos si se vendió más
  // desde la primera visita. Las otras pestañas se cachean para preservar su estado
  // (ej. el carrito de Vender no se debe vaciar al cambiar de pestaña y volver).
  if (tab === 'reportes') clearTab(tab);
  if (!currentCleanups[tab]) {
    const cleanup = INIT_FNS[tab](currentFeria);
    currentCleanups[tab] = cleanup || (() => {});
  }
}

export function initFeriaView(feria, { onExit }) {
  TABS.forEach(clearTab);
  currentFeria = feria;

  const view = document.getElementById('feria-view');
  const titulo = document.getElementById('feria-titulo');
  view.classList.remove('hidden');
  titulo.textContent = `${feria.emoji} ${feria.nombre}`;

  if (!tabButtonsBound) {
    document.querySelectorAll('.tab-btn').forEach((btn) => {
      btn.addEventListener('click', () => showTab(btn.dataset.tab));
    });
    tabButtonsBound = true;
  }

  document.getElementById('btn-cambiar-feria').onclick = () => {
    TABS.forEach(clearTab);
    view.classList.add('hidden');
    onExit();
  };

  showTab('vender');
}
