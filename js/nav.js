import { initVender, cerrarSheet } from './vender.js';
import { initInventario } from './inventario.js';
import { initIdeas } from './ideas.js';
import { initReportes } from './reportes.js';

const TABS = ['vender', 'inventario', 'ideas', 'reportes'];
const INIT_FNS = { vender: initVender, inventario: initInventario, ideas: initIdeas, reportes: initReportes };

let currentFeria = null;
let currentCleanups = {};
let tabButtonsBound = false;
let tecladoBound = false;

function clearTab(tab) {
  if (currentCleanups[tab]) {
    currentCleanups[tab]();
    currentCleanups[tab] = null;
  }
  document.getElementById(`tab-${tab}`).innerHTML = '';
}

function showTab(tab) {
  const view = document.getElementById('feria-view');
  view.dataset.tab = tab; // dispara el padding-bottom correcto del scroll (reserva dock sólo en Vender)

  TABS.forEach((t) => {
    document.getElementById(`tab-${t}`).classList.toggle('hidden', t !== tab);
  });
  document.querySelectorAll('.tabbar__item').forEach((btn) => {
    const activo = btn.dataset.tab === tab;
    btn.classList.toggle('is-active', activo);
    if (activo) btn.setAttribute('aria-current', 'page');
    else btn.removeAttribute('aria-current');
  });

  // El carrito (dock/hoja) sólo tiene sentido en Vender: al salir, cerrá la hoja para
  // no dejar un carrito abierto tapando otra sección.
  if (tab !== 'vender') cerrarSheet();

  // Reportes e Inventario son vistas que dependen de datos que cambian desde OTRO lado
  // (una venta en Vender descuenta stock; poner un precio "al vuelo" en Vender actualiza
  // feria_productos) y no tienen suscripción realtime propia — re-fetchear al entrar es
  // la única forma de no mostrar stock/precio viejo. Vender e Ideas sí se cachean para
  // preservar su estado (ej. el carrito de Vender no se debe vaciar al cambiar de pestaña).
  if (tab === 'reportes' || tab === 'inventario') clearTab(tab);
  if (!currentCleanups[tab]) {
    const cleanup = INIT_FNS[tab](currentFeria);
    currentCleanups[tab] = cleanup || (() => {});
  }
}

// Con el teclado del celular abierto, la tab bar/dock roban alto y pueden tapar el input.
// Marcamos la vista mientras un campo tiene foco para ocultarlas (mitigación iOS).
function bindTeclado(view) {
  if (tecladoBound) return;
  tecladoBound = true;
  const esCampo = (el) => el && el.matches && el.matches('input, select, textarea');
  view.addEventListener('focusin', (e) => { if (esCampo(e.target)) view.classList.add('teclado-abierto'); });
  view.addEventListener('focusout', (e) => {
    if (!esCampo(e.target)) return;
    // Pequeño respiro para permitir saltar de un campo a otro sin parpadeo de la barra.
    setTimeout(() => { if (!esCampo(document.activeElement)) view.classList.remove('teclado-abierto'); }, 120);
  });
}

export function initFeriaView(feria, { onExit }) {
  TABS.forEach(clearTab);
  currentFeria = feria;

  const view = document.getElementById('feria-view');
  const titulo = document.getElementById('feria-titulo');
  view.classList.remove('hidden');
  titulo.textContent = `${feria.emoji} ${feria.nombre}`;

  bindTeclado(view);

  if (!tabButtonsBound) {
    document.querySelectorAll('.tabbar__item').forEach((btn) => {
      btn.addEventListener('click', () => showTab(btn.dataset.tab));
    });
    tabButtonsBound = true;
  }

  document.getElementById('btn-cambiar-feria').onclick = () => {
    cerrarSheet();
    TABS.forEach(clearTab);
    view.classList.add('hidden');
    onExit();
  };

  showTab('vender');
}
