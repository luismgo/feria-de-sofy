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
