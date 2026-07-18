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
// Varios toasts pueden estar visibles a la vez (ej. dos "Deshacer" seguidos): todos
// viven dentro de un único contenedor apilable en vez de tirarse sueltos al body,
// para que el más nuevo no tape literalmente al anterior.
function toastStack() {
  let stack = document.getElementById('toast-stack');
  if (!stack) {
    stack = document.createElement('div');
    stack.id = 'toast-stack';
    stack.className = 'toast-stack';
    document.body.appendChild(stack);
  }
  return stack;
}

// tipo: 'exito' | 'error' | undefined (neutro)
// accionLabel + onAccion: agrega un botón (ej. "Deshacer") que ejecuta onAccion()
// y cierra el toast de inmediato. Sin ellos, comportamiento idéntico al de siempre.
export function toast(message, { tipo, accionLabel, onAccion } = {}) {
  const el = document.createElement('div');
  el.className = `toast${tipo ? ` toast--${tipo}` : ''}`;

  let cerrarAhora = () => {};
  if (accionLabel && onAccion) {
    const texto = document.createElement('span');
    texto.textContent = message;
    const boton = document.createElement('button');
    boton.type = 'button';
    boton.className = 'toast__accion';
    boton.textContent = accionLabel;
    boton.addEventListener('click', () => { onAccion(); cerrarAhora(); });
    el.append(texto, boton);
  } else {
    el.textContent = message;
  }

  toastStack().appendChild(el);
  setTimeout(() => el.classList.add('toast--visible'), 10);
  const ocultarTimeout = setTimeout(() => {
    el.classList.remove('toast--visible');
    setTimeout(() => el.remove(), 300);
  }, 2500);

  // Cierre anticipado (botón de acción): cancela el timeout de auto-ocultado pendiente
  cerrarAhora = () => {
    clearTimeout(ocultarTimeout);
    el.classList.remove('toast--visible');
    setTimeout(() => el.remove(), 300);
  };
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
// variante: 'productos' | 'ideas' | 'reportes' | undefined -- tinte de color del badge por sección.
export function emptyState(emoji, titulo, hint = '', variante) {
  return `
    <div class="empty">
      <span class="empty__emoji${variante ? ` empty__emoji--${variante}` : ''}" aria-hidden="true">${emoji}</span>
      <p class="empty__titulo">${escapeHtml(titulo)}</p>
      ${hint ? `<p class="empty__hint">${escapeHtml(hint)}</p>` : ''}
    </div>
  `;
}

// Estado de carga. Sin kind: spinner + texto (igual que siempre).
// Con kind ('grid' | 'lista' | 'reporte'): esqueleto pulsante con la forma aproximada
// del contenido real, para que el layout no salte cuando llegan los datos.
export function cargando(texto = 'Cargando...', { kind } = {}) {
  if (!kind) {
    return `
      <div class="loading" role="status">
        <span class="spinner" aria-hidden="true"></span>
        <span>${escapeHtml(texto)}</span>
      </div>
    `;
  }
  const conteos = { grid: 6, lista: 5, reporte: 3 };
  const bloque = kind === 'lista' ? 'skeleton__row' : 'skeleton__card';
  const cantidad = conteos[kind] ?? conteos.grid;
  const variante = conteos[kind] ? kind : 'grid';
  return `
    <div class="skeleton skeleton--${variante}" role="status" aria-label="${escapeHtml(texto)}">
      ${Array.from({ length: cantidad }, () => `<div class="${bloque}"></div>`).join('')}
    </div>
  `;
}

// Vibración táctil corta (confirmar tap, alertar error). Feature-detection: no-op
// en navegadores/dispositivos sin soporte (ej. iOS Safari), nunca lanza.
export function vibrar(ms = 15) {
  if (navigator.vibrate) {
    try { navigator.vibrate(ms); } catch {}
  }
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

// Filtra por substring de nombre, case-insensitive. Query vacío (o solo espacios) devuelve
// todo sin tocar el array. Usado por los buscadores de Inventario (Categorías, Combos,
// Productos, Insumos) para filtrar en memoria, sin re-fetch.
export function filtrarPorNombre(items, query, getNombre) {
  const q = query.trim().toLowerCase();
  if (!q) return items;
  return items.filter((item) => getNombre(item).toLowerCase().includes(q));
}

const collatorEs = new Intl.Collator('es');

// Ordena por el criterio elegido en un <select> de orden. `criterios` mapea el value del
// select a una función que extrae el valor numérico a comparar; un criterio sin entrada en
// `criterios` (ej. 'nombre') deja el orden puramente alfabético. Todo criterio no alfabético
// usa el nombre como desempate, para que el resultado sea estable ante empates numéricos.
export function ordenar(items, criterio, criterios, getNombre) {
  const extraer = criterios[criterio];
  return [...items].sort((a, b) => {
    if (extraer) {
      const diff = extraer(a) - extraer(b);
      if (diff !== 0 && !Number.isNaN(diff)) return diff;
    }
    return collatorEs.compare(getNombre(a), getNombre(b));
  });
}

// Comprimir una foto antes de subirla: las que llegan del celular o de un excel
// importado pesan 500KB-1MB para mostrarse en miniaturas de 40-90px, lo que atrasa
// el render de la grilla. Redimensiona al lado mayor y reencoda a JPEG.
export async function comprimirImagen(file, { maxDim = 800, calidad = 0.8 } = {}) {
  const bitmap = await createImageBitmap(file);
  const escala = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height));
  const w = Math.round(bitmap.width * escala);
  const h = Math.round(bitmap.height * escala);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff'; // PNG con transparencia no se vuelve negro al pasar a JPEG
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(bitmap, 0, 0, w, h);
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', calidad));
  return blob || file; // si el navegador no puede generar el blob, se sube la foto original
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
