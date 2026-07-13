// ============================================================
// Primitivas de UI compartidas: diálogos, toasts, campos, estados.
// Todos los overlays pasan por abrirDialogo(): un solo lugar con la
// accesibilidad completa (role=dialog, foco, focus trap, Escape, backdrop).
// ============================================================

// --- Núcleo de overlay ---
// Crea overlay + diálogo con a11y completa. Devuelve { el, dialogo, cerrar }.
// - `el` es el overlay (para delegación de eventos: sobrevive re-renders del contenido)
// - `cerrar(valor)` desmonta y devuelve el foco a quien abrió
// - onCerrar(valor) se llama exactamente una vez
export function abrirDialogo({ contenidoHTML = '', claseExtra = '', etiqueta = 'Diálogo', onCerrar = () => {} } = {}) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  const dialogo = document.createElement('div');
  dialogo.className = `modal ${claseExtra}`.trim();
  dialogo.setAttribute('role', 'dialog');
  dialogo.setAttribute('aria-modal', 'true');
  dialogo.setAttribute('aria-label', etiqueta);
  dialogo.tabIndex = -1;
  dialogo.innerHTML = contenidoHTML;
  overlay.appendChild(dialogo);

  const invocador = document.activeElement;
  let cerrado = false;

  function cerrar(valor) {
    if (cerrado) return;
    cerrado = true;
    document.removeEventListener('keydown', onKeydown);
    overlay.remove();
    // Devolver el foco a quien abrió (si sigue en el documento)
    if (invocador && invocador.focus && document.contains(invocador)) invocador.focus();
    onCerrar(valor);
  }

  function onKeydown(e) {
    if (e.key === 'Escape') { e.stopPropagation(); cerrar(null); return; }
    if (e.key !== 'Tab') return;
    // Focus trap simple: Tab cicla dentro del diálogo
    const focusables = dialogo.querySelectorAll('button:not(:disabled), [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
    if (!focusables.length) return;
    const primero = focusables[0];
    const ultimo = focusables[focusables.length - 1];
    if (e.shiftKey && document.activeElement === primero) { e.preventDefault(); ultimo.focus(); }
    else if (!e.shiftKey && document.activeElement === ultimo) { e.preventDefault(); primero.focus(); }
  }

  // Tap en el fondo oscuro = cancelar (no destruye nada: cancelar siempre es seguro)
  overlay.addEventListener('click', (e) => { if (e.target === overlay) cerrar(null); });
  document.addEventListener('keydown', onKeydown);
  document.body.appendChild(overlay);

  // Foco inicial: el primer [autofocus], o el diálogo mismo
  const auto = dialogo.querySelector('[autofocus]');
  (auto || dialogo).focus();

  return { el: overlay, dialogo, cerrar };
}

// Modal rico para contenido propio (crear feria, combos, insumos, reutilizar).
// El caller arma el HTML y cablea eventos con delegación sobre `dialogo`
// (los listeners delegados sobreviven a re-renders del innerHTML interno).
export function abrirModal({ titulo = '', contenidoHTML = '', claseExtra = '' } = {}) {
  let resolver;
  const cerrado = new Promise((res) => { resolver = res; });
  const html = `${titulo ? `<h3 class="modal__title">${escapeHtml(titulo)}</h3>` : ''}${contenidoHTML}`;
  const { el, dialogo, cerrar } = abrirDialogo({
    contenidoHTML: html,
    claseExtra,
    etiqueta: titulo || 'Diálogo',
    onCerrar: (valor) => resolver(valor),
  });
  return { el, dialogo, cerrar, cerrado };
}

// Confirmación sí/no. Escape y tap en el fondo = "no" (cancelar es seguro).
export function confirmDialog(message, { peligro = false } = {}) {
  return new Promise((resolve) => {
    const { dialogo, cerrar } = abrirDialogo({
      etiqueta: 'Confirmación',
      contenidoHTML: `
        <p>${message}</p>
        <div class="modal-actions">
          <button type="button" class="btn btn--secondary" data-action="no">Cancelar</button>
          <button type="button" class="btn ${peligro ? 'btn--danger' : 'btn--primary'}" data-action="si">Confirmar</button>
        </div>
      `,
      onCerrar: (valor) => resolve(valor === true),
    });
    dialogo.addEventListener('click', (e) => {
      const action = e.target.closest('[data-action]')?.dataset.action;
      if (action === 'no') cerrar(false);
      if (action === 'si') cerrar(true);
    });
  });
}

// Pedir un texto/número. Resuelve con el string ingresado, o null si se cancela.
export function promptDialog(message, { placeholder = '', value = '', okLabel = 'Guardar', tipo = 'text' } = {}) {
  return new Promise((resolve) => {
    const { dialogo, cerrar } = abrirDialogo({
      etiqueta: 'Ingresar dato',
      contenidoHTML: `
        <p>${escapeHtml(message)}</p>
        <input class="input" type="${tipo}" placeholder="${escapeHtml(placeholder)}" value="${escapeHtml(value)}" autofocus />
        <div class="modal-actions">
          <button type="button" class="btn btn--secondary" data-action="no">Cancelar</button>
          <button type="button" class="btn btn--primary" data-action="si">${escapeHtml(okLabel)}</button>
        </div>
      `,
      onCerrar: (valor) => resolve(typeof valor === 'string' ? valor : null),
    });
    const input = dialogo.querySelector('.input');
    dialogo.addEventListener('click', (e) => {
      const action = e.target.closest('[data-action]')?.dataset.action;
      if (action === 'no') cerrar(null);
      if (action === 'si') cerrar(input.value);
    });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); cerrar(input.value); }
    });
  });
}

// --- Toast ---
// tipo: 'exito' | 'error' | undefined (neutro)
export function toast(message, { tipo } = {}) {
  const el = document.createElement('div');
  el.className = `toast${tipo ? ` toast--${tipo}` : ''}`;
  el.textContent = message;
  document.body.appendChild(el);
  setTimeout(() => el.classList.add('toast--visible'), 10);
  setTimeout(() => {
    el.classList.remove('toast--visible');
    setTimeout(() => el.remove(), 300);
  }, 2500);
}

// --- Helpers de template ---

// Campo con etiqueta visible + hint opcional. attrs es HTML de atributos ya escapados
// por el caller cuando interpola datos de la usuaria.
export function campo({ label, hint = '', input }) {
  return `
    <label class="field">
      <span class="field__label">${escapeHtml(label)}</span>
      ${input}
      ${hint ? `<span class="field__hint">${escapeHtml(hint)}</span>` : ''}
    </label>
  `;
}

// Estado vacío de panel: emoji + título + pista de qué hacer.
export function emptyState(emoji, titulo, hint = '') {
  return `
    <div class="empty">
      <span class="empty__emoji" aria-hidden="true">${emoji}</span>
      <p class="empty__titulo">${escapeHtml(titulo)}</p>
      ${hint ? `<p class="empty__hint">${escapeHtml(hint)}</p>` : ''}
    </div>
  `;
}

// Estado de carga: spinner + texto.
export function cargando(texto = 'Cargando...') {
  return `
    <div class="loading" role="status">
      <span class="spinner" aria-hidden="true"></span>
      <span>${escapeHtml(texto)}</span>
    </div>
  `;
}

// Ejecuta una escritura de Supabase y avisa por toast si falla, en vez de fallar en silencio.
export async function mutar(promesa, mensajeError = 'No se pudo guardar el cambio') {
  const { data, error } = await promesa;
  if (error) {
    toast(mensajeError, { tipo: 'error' });
    console.error(mensajeError, error);
  }
  return { data, error };
}

// Escapa texto que viene de la usuaria (nombres, notas, emojis) antes de meterlo en innerHTML,
// para que una comilla o un < no rompan el render ni el atributo.
export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

// Formatea un monto en pesos con separador de miles (ej. 1234 -> "$1.234").
// Locale es-CO: separador de miles con PUNTO, como se lee la plata en Colombia.
export function formatMoney(n) {
  return '$' + Number(n || 0).toLocaleString('es-CO');
}

// UUID con fallback: crypto.randomUUID sólo existe en contexto seguro (https/localhost);
// servida por IP en la LAN (http plano) tiraría excepción, así que caemos a un generador propio.
export function uuid() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}
