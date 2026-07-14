import { supabase } from './supabaseClient.js';
import { toast, escapeHtml, formatMoney, promptDialog, uuid, confirmDialog, abrirModal, cargando, emptyState, vibrar } from './ui.js';
import { isOnline } from './connection.js';

let realtimeChannel = null;
let carrito = []; // { tipo:'producto', productoId, nombre, precio, cantidad } | { tipo:'combo', comboId, nombre, precio, productos:[{id,nombre}] } | { tipo:'manual', nombre, precio }
let metodoPagoActual = 'efectivo';
let clientVentaIdPendiente = null;
let descuentoActual = 0;
let pagaConActual = ''; // "¿con cuánto te paga?" — sólo UI, nunca viaja al RPC
let filtroBusqueda = '';
let filtroCategoriaActiva = null; // null = "Todas"; sobrevive un re-render por realtime igual que filtroBusqueda
let rankingCongelado = []; // ids de producto ordenados por más vendidos, calculado 1 vez por sesión de feria
let feriaProductosActuales = [];
let combosActuales = [];
let sheetAbierta = false;
let ultimoCountDock = 0;

export function initVender(feria) {
  carrito = [];
  metodoPagoActual = 'efectivo';
  clientVentaIdPendiente = null;
  descuentoActual = 0;
  pagaConActual = '';
  filtroBusqueda = '';
  filtroCategoriaActiva = null;
  rankingCongelado = [];
  feriaProductosActuales = [];
  combosActuales = [];
  ultimoCountDock = 0;
  restaurarCarrito(feria.id); // un refresh en plena feria no pierde el carrito
  resetCarritoUI();
  const container = document.getElementById('tab-vender');
  container.innerHTML = cargando('Cargando productos...', { kind: 'grid' });

  // initVender NO puede ser async (devuelve la función de cleanup a nav.js), así que
  // no se puede `await`. Se re-renderiza cuando el ranking resuelve, para que el orden
  // "más vendidos arriba" se aplique aunque el usuario no interactúe.
  cargarRanking(feria).then(() => loadAndRender(feria, container));

  // Los eventos realtime (otro dispositivo, cambios de stock) sólo re-dibujan la grilla:
  // NO tocan la hoja del carrito, para no destruir el input de descuento mientras Sofy
  // lo tipea (fix de foco B). El carrito es estado de cliente y no cambia por stock ajeno.
  realtimeChannel = supabase
    .channel(`vender-${feria.id}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'productos' }, () => loadAndRender(feria, container, { refrescarCarrito: false }))
    .on('postgres_changes', { event: '*', schema: 'public', table: 'feria_productos' }, () => loadAndRender(feria, container, { refrescarCarrito: false }))
    .on('postgres_changes', { event: '*', schema: 'public', table: 'categorias_precio' }, () => loadAndRender(feria, container, { refrescarCarrito: false }))
    .subscribe();

  return () => {
    if (realtimeChannel) {
      supabase.removeChannel(realtimeChannel);
      realtimeChannel = null;
    }
    cerrarSheet();
  };
}

// --- Persistencia del carrito (sobrevivir un refresh accidental en plena feria) ---

function persistirCarrito(feriaId) {
  try {
    if (carrito.length === 0) localStorage.removeItem(`carrito:${feriaId}`);
    else localStorage.setItem(`carrito:${feriaId}`, JSON.stringify({ carrito, descuento: descuentoActual, metodo: metodoPagoActual }));
  } catch { /* almacenamiento bloqueado o lleno: la app sigue sin persistir */ }
}

function restaurarCarrito(feriaId) {
  try {
    const raw = localStorage.getItem(`carrito:${feriaId}`);
    if (!raw) return;
    const guardado = JSON.parse(raw);
    if (Array.isArray(guardado.carrito)) carrito = guardado.carrito;
    descuentoActual = Math.max(0, Number(guardado.descuento) || 0);
    if (guardado.metodo === 'efectivo' || guardado.metodo === 'transferencia') metodoPagoActual = guardado.metodo;
  } catch { /* dato corrupto: se empieza con carrito vacío */ }
}

// Un carrito restaurado (o uno viejo tras vender en otro dispositivo) puede pedir más
// stock del que queda: se recorta acá por UX; el RPC igual valida server-side.
function clampCarritoContraStock(feriaId) {
  let cambiado = false;
  carrito = carrito.filter((l) => {
    if (l.tipo !== 'producto') return true; // combos y manuales los valida el RPC
    const fp = feriaProductosActuales.find((f) => f.productos.id === l.productoId);
    if (!fp || fp.productos.stock <= 0) { cambiado = true; return false; }
    if (l.cantidad > fp.productos.stock) { l.cantidad = fp.productos.stock; cambiado = true; }
    return true;
  });
  if (cambiado) {
    clientVentaIdPendiente = null;
    persistirCarrito(feriaId);
    toast('El carrito se ajustó al stock disponible');
  }
}

async function loadAndRender(feria, container, { refrescarCarrito = true } = {}) {
  const [{ data: feriaProductos, error: prodError }, { data: combos, error: comboError }] = await Promise.all([
    supabase.from('feria_productos').select('id, categoria_precio_id, precio_override, productos(id, nombre, descripcion, imagen_url, stock), categorias_precio(nombre, precio)').eq('feria_id', feria.id),
    supabase.from('combos').select('*').eq('feria_id', feria.id).eq('activo', true).order('nombre'),
  ]);

  if (prodError || comboError) {
    container.innerHTML = '<p class="error">No se pudieron cargar los productos</p>';
    return;
  }

  feriaProductosActuales = feriaProductos || [];
  combosActuales = combos || [];
  if (refrescarCarrito) clampCarritoContraStock(feria.id);
  renderGrid(feria, feriaProductosActuales, combosActuales, container);
  if (refrescarCarrito) renderCarrito(feria, container);
}

function precioEfectivo(fp) {
  if (fp.precio_override != null) return fp.precio_override;
  return fp.categorias_precio ? fp.categorias_precio.precio : null;
}

function cantidadEnCarrito(productoId) {
  let total = 0;
  carrito.forEach((linea) => {
    if (linea.tipo === 'producto' && linea.productoId === productoId) total += linea.cantidad;
    if (linea.tipo === 'combo') total += linea.productos.filter((p) => p.id === productoId).length;
  });
  return total;
}

// Aplica el filtro del buscador + el chip de categoría activo ocultando/mostrando tarjetas
// ya renderizadas, en vez de reconstruir la grilla en cada tecla (que saltaba el cursor y
// parpadeaba el teclado).
function aplicarFiltroBusqueda(grid) {
  const term = filtroBusqueda.trim().toLowerCase();
  grid.querySelectorAll('.producto-card').forEach((card) => {
    const coincideTexto = !term || (card.dataset.nombre || '').includes(term);
    // Las tarjetas sin categoría (sin precio, "Otro monto") no tienen data-categoria:
    // quedan siempre visibles, filtrar por categoría nunca debe esconder "Otro monto".
    const tieneCategoria = 'categoria' in card.dataset;
    const coincideCategoria = !filtroCategoriaActiva || !tieneCategoria || card.dataset.categoria === filtroCategoriaActiva;
    card.classList.toggle('hidden', !(coincideTexto && coincideCategoria));
  });
}

// Dibuja buscador + combos + grilla de productos en el panel de Vender (no el carrito).
function renderGrid(feria, feriaProductos, combos, container) {
  // Fix de foco (B): si un evento realtime entra mientras Sofy tipea en el buscador,
  // preservamos foco y posición del cursor tras reconstruir la grilla.
  const activo = document.activeElement;
  const preservarBuscador = !!(activo && activo.classList && activo.classList.contains('vender-buscador'));
  const selStart = preservarBuscador ? activo.selectionStart : null;
  const selEnd = preservarBuscador ? activo.selectionEnd : null;

  container.innerHTML = '';

  const sinNada = feriaProductos.length === 0 && combos.length === 0;

  // Categorías de precio distintas presentes en esta feria, para el filtro por chips.
  const categoriasPresentes = [...new Set(
    feriaProductos.map((fp) => fp.categorias_precio && fp.categorias_precio.nombre).filter(Boolean),
  )];
  // Si la categoría activa dejó de existir (renombrada/borrada por otro dispositivo), no se
  // queda pegada escondiendo todo el catálogo en silencio.
  if (filtroCategoriaActiva && !categoriasPresentes.includes(filtroCategoriaActiva)) filtroCategoriaActiva = null;

  if (!sinNada) {
    const header = document.createElement('div');
    header.className = 'vender-header';

    const buscador = document.createElement('input');
    buscador.className = 'vender-buscador';
    buscador.type = 'search';
    buscador.placeholder = 'Buscar producto...';
    buscador.setAttribute('aria-label', 'Buscar producto');
    buscador.value = filtroBusqueda;
    buscador.addEventListener('input', () => {
      filtroBusqueda = buscador.value;
      const grid = container.querySelector('.productos-grid');
      if (grid) aplicarFiltroBusqueda(grid); // sin re-render: conserva foco y posición del cursor
    });
    header.appendChild(buscador);

    if (categoriasPresentes.length > 0) {
      const chips = document.createElement('div');
      chips.className = 'vender-chips';
      chips.innerHTML = ['Todas', ...categoriasPresentes].map((nombre) => {
        const esTodas = nombre === 'Todas';
        const activa = esTodas ? !filtroCategoriaActiva : filtroCategoriaActiva === nombre;
        return `<button type="button" class="chip-categoria ${activa ? 'is-active' : ''}" data-categoria="${escapeHtml(esTodas ? '' : nombre)}">${escapeHtml(nombre)}</button>`;
      }).join('');
      chips.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-categoria]');
        if (!btn) return;
        filtroCategoriaActiva = btn.dataset.categoria || null;
        chips.querySelectorAll('.chip-categoria').forEach((c) => c.classList.toggle('is-active', c === btn));
        const grid = container.querySelector('.productos-grid');
        if (grid) aplicarFiltroBusqueda(grid); // sin re-render: conserva foco y posición del cursor del buscador
      });
      header.appendChild(chips);
    }

    container.appendChild(header);
  } else {
    const vacio = document.createElement('div');
    vacio.innerHTML = emptyState('🌸', 'Sin productos todavía', 'Agregalos en la pestaña Inventario y acá aparecen para vender.');
    container.appendChild(vacio.firstElementChild);
  }

  if (combos.length > 0) {
    const combosRow = document.createElement('div');
    combosRow.className = 'combos-row';
    combos.forEach((combo) => {
      const btn = document.createElement('button');
      btn.className = 'combo-btn';
      btn.textContent = `${combo.nombre} · ${formatMoney(combo.precio)}`;
      btn.addEventListener('click', () => agregarComboAlCarrito(combo, feriaProductos, feria, container));
      combosRow.appendChild(btn);
    });
    container.appendChild(combosRow);
  }

  const ordenados = [...feriaProductos].sort((a, b) => {
    const ra = rankingCongelado.indexOf(a.productos.id);
    const rb = rankingCongelado.indexOf(b.productos.id);
    const rankA = ra === -1 ? Infinity : ra;
    const rankB = rb === -1 ? Infinity : rb;
    if (rankA !== rankB) return rankA - rankB;               // más vendidos primero (congelado)
    return a.productos.nombre.localeCompare(b.productos.nombre, 'es'); // luego alfabético estable
  });
  const grid = document.createElement('div');
  grid.className = 'productos-grid';
  ordenados.forEach((fp) => {
    const p = fp.productos;
    const precio = precioEfectivo(fp);
    const disponible = p.stock - cantidadEnCarrito(p.id);
    const card = document.createElement('button');
    card.className = 'producto-card';
    card.dataset.nombre = p.nombre.toLowerCase();

    // (C2) markup común de foto+nombre, una sola vez: cada rama añade sólo su parte variable.
    const media = p.imagen_url
      ? `<img src="${p.imagen_url}" alt="${escapeHtml(p.nombre)}" />`
      : '<div class="producto-card__sin-foto">🌸</div>';
    const nombre = `<span class="producto-card__nombre">${escapeHtml(p.nombre)}</span>`;
    const desc = p.descripcion ? `<span class="producto-card__desc">${escapeHtml(p.descripcion)}</span>` : '';

    if (precio == null) {
      card.classList.add('producto-card--sin-precio');
      card.innerHTML = `${media}${nombre}${desc}<span class="producto-card__poner-precio">Tocar para poner precio</span>`;
      card.addEventListener('click', async () => {
        const val = await promptDialog(`Precio de "${p.nombre}" en esta feria:`, { placeholder: 'Ej: 100', tipo: 'number', okLabel: 'Poner precio' });
        if (val === null) return; // el usuario canceló
        const precioNuevo = Number(val);
        if (!Number.isFinite(precioNuevo) || precioNuevo <= 0) { toast('Poné un precio válido mayor a 0.'); return; }
        const { error } = await supabase.from('feria_productos').update({ precio_override: precioNuevo }).eq('id', fp.id);
        if (error) { toast('No se pudo guardar el precio. Probá de nuevo.'); return; }
        loadAndRender(feria, container);
      });
      grid.appendChild(card);
      return; // continúa el forEach
    }
    if (fp.categorias_precio && fp.categorias_precio.nombre) card.dataset.categoria = fp.categorias_precio.nombre;
    card.disabled = disponible <= 0;
    card.innerHTML = `${media}${nombre}${desc}
      <span class="producto-card__precio">${formatMoney(precio)}</span>
      <span class="producto-card__stock ${disponible > 0 ? '' : 'producto-card__stock--agotado'}">${disponible > 0 ? `Quedan ${disponible}` : 'Agotado'}</span>`;
    card.addEventListener('click', () => agregarProductoAlCarrito(p, precio, feria, container));
    grid.appendChild(card);
  });

  // "Otro monto": vender algo fuera de la lista (encargo, precio especial) — línea manual del RPC.
  const otroBtn = document.createElement('button');
  otroBtn.className = 'producto-card producto-card--otro';
  otroBtn.innerHTML = `
    <span class="producto-card__otro-icono" aria-hidden="true"><svg class="icon"><use href="#i-mas"/></svg></span>
    <span class="producto-card__nombre">Otro monto</span>
    <span class="producto-card__stock">Algo fuera de la lista</span>`;
  otroBtn.addEventListener('click', () => abrirOtroMonto(feria, container));
  grid.appendChild(otroBtn);

  container.appendChild(grid);
  aplicarFiltroBusqueda(grid); // conserva el filtro activo tras un re-render (ej. agregar al carrito)

  if (preservarBuscador) {
    const nb = container.querySelector('.vender-buscador');
    if (nb) { nb.focus(); try { nb.setSelectionRange(selStart, selEnd); } catch { /* type=search sin selección: ignorar */ } }
  }
}

function abrirOtroMonto(feria, container) {
  const { dialogo, cerrar } = abrirModal({
    titulo: 'Cobrar otro monto',
    contenidoHTML: `
      <p class="card__hint">Para vender algo que no está en la lista (un encargo, un precio especial). No descuenta stock.</p>
      <label class="field">
        <span class="field__label">Monto en pesos</span>
        <input type="number" class="input" id="otro-monto-valor" min="1" inputmode="numeric" placeholder="Ej: 5000" autofocus />
      </label>
      <label class="field">
        <span class="field__label">Qué es (opcional)</span>
        <input type="text" class="input" id="otro-monto-nota" placeholder="Ej: encargo de pulsera" />
      </label>
      <div class="modal-actions">
        <button type="button" class="btn btn--secondary" data-action="cancelar">Cancelar</button>
        <button type="button" class="btn btn--primary" data-action="agregar">Agregar al carrito</button>
      </div>`,
  });
  dialogo.addEventListener('click', (e) => {
    const action = e.target.closest('[data-action]')?.dataset.action;
    if (action === 'cancelar') cerrar(null);
    if (action === 'agregar') {
      const monto = Number(dialogo.querySelector('#otro-monto-valor').value);
      if (!Number.isFinite(monto) || monto <= 0) { toast('Poné un monto válido mayor a 0.'); return; }
      const nota = dialogo.querySelector('#otro-monto-nota').value.trim();
      carrito.push({ tipo: 'manual', nombre: nota || 'Venta manual', precio: monto });
      cerrar(true);
      refrescarVenta(feria, container);
    }
  });
}

function agregarProductoAlCarrito(producto, precio, feria, container) {
  const disponible = producto.stock - cantidadEnCarrito(producto.id);
  if (disponible <= 0) {
    toast('No queda más stock disponible de ese producto');
    return;
  }
  const linea = carrito.find((l) => l.tipo === 'producto' && l.productoId === producto.id);
  if (linea) linea.cantidad += 1;
  else carrito.push({ tipo: 'producto', productoId: producto.id, nombre: producto.nombre, precio, cantidad: 1 });
  refrescarVenta(feria, container);
}

// Re-dibuja grilla (recalcula "Quedan N" en cliente) y carrito (dock + hoja) tras un cambio del carrito.
function refrescarVenta(feria, container) {
  clientVentaIdPendiente = null; // el carrito cambió => nueva venta lógica
  persistirCarrito(feria.id);
  renderGrid(feria, feriaProductosActuales, combosActuales, container);
  renderCarrito(feria, container);
}

function resetCarritoUI() {
  cerrarSheet();
  const dock = document.getElementById('carrito-dock');
  const sheet = document.getElementById('carrito-sheet');
  if (dock) { dock.classList.remove('has-items'); dock.innerHTML = ''; }
  if (sheet) sheet.innerHTML = '';
}

function abrirSheet() {
  const sheet = document.getElementById('carrito-sheet');
  const backdrop = document.getElementById('carrito-backdrop');
  if (!sheet || carrito.length === 0) return;
  sheet.classList.add('is-open');
  if (backdrop) backdrop.classList.remove('hidden');
  sheetAbierta = true;
  document.addEventListener('keydown', onSheetKeydown);
  sheet.focus(); // foco al diálogo (tabindex=-1); Escape cierra, el foco vuelve al dock
}

export function cerrarSheet() {
  const sheet = document.getElementById('carrito-sheet');
  const backdrop = document.getElementById('carrito-backdrop');
  if (sheet) sheet.classList.remove('is-open');
  if (backdrop) backdrop.classList.add('hidden');
  if (sheetAbierta) {
    document.removeEventListener('keydown', onSheetKeydown);
    const dock = document.getElementById('carrito-dock');
    if (dock && dock.classList.contains('has-items')) dock.focus();
  }
  sheetAbierta = false;
}

function onSheetKeydown(e) {
  // Si hay un modal encima de la hoja (confirmar vaciado, otro monto), su Escape
  // es del modal: la hoja no se cierra por debajo.
  if (e.key === 'Escape' && !document.querySelector('.modal-overlay')) cerrarSheet();
}

// Texto secundario de una línea del carrito según su tipo.
function detalleLinea(l) {
  if (l.tipo === 'producto') return `${formatMoney(l.precio)} c/u`;
  if (l.tipo === 'combo') return l.productos.map((p) => p.nombre).join(', ');
  return 'Monto libre';
}

// Quita una línea del carrito pero deja un toast con "Deshacer": si Sofy no lo toca,
// el quitado queda firme (comportamiento final idéntico al de antes de este cambio).
function quitarLineaConDeshacer(feria, container, index) {
  const linea = carrito[index];
  if (!linea) return;
  carrito.splice(index, 1);
  if (carrito.length === 0) cerrarSheet();
  refrescarVenta(feria, container);
  toast(`Quitaste "${linea.nombre}"`, {
    accionLabel: 'Deshacer',
    onAccion: () => {
      // El carrito puede haber cambiado de tamaño mientras el toast estaba abierto (otra línea
      // quitada, un agregado nuevo): se reinserta lo más cerca posible de su posición original.
      carrito.splice(Math.min(index, carrito.length), 0, linea);
      refrescarVenta(feria, container);
    },
  });
}

// Drag-to-dismiss de la hoja del carrito: sólo desde el handle decorativo de arriba,
// nunca desde .sheet__body (así el scroll interno de la lista de líneas queda intacto).
function wireDragDismiss(sheet) {
  const handle = sheet.querySelector('.carrito-sheet__handle');
  if (!handle) return;
  sheet.style.transform = ''; // por si quedó un drag a medias de un render anterior
  handle.style.touchAction = 'none'; // funcional, no visual: sin esto el navegador se roba el gesto para hacer scroll de la página

  const reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  let arrancoY = 0;
  let arrancoT = 0;
  let alturaSheet = 0;
  let arrastrando = false;

  const mover = (e) => {
    if (!arrastrando) return;
    const delta = Math.max(0, e.clientY - arrancoY); // sólo se arrastra hacia abajo, nunca hacia arriba
    sheet.style.transform = `translateY(${delta}px)`;
  };

  const soltar = (e) => {
    if (!arrastrando) return;
    arrastrando = false;
    sheet.classList.remove('carrito-sheet--arrastrando');
    const delta = Math.max(0, e.clientY - arrancoY);
    const duracion = Math.max(1, performance.now() - arrancoT);
    const velocidad = delta / duracion; // px/ms

    if (alturaSheet > 0 && (delta > alturaSheet * 0.35 || velocidad > 0.6)) {
      sheet.style.transform = ''; // suelta el override inline; is-open sigue gobernando la posición
      cerrarSheet();
      return;
    }

    if (reduceMotion) {
      sheet.style.transform = '';
    } else {
      sheet.classList.add('carrito-sheet--volviendo');
      sheet.style.transform = '';
      setTimeout(() => sheet.classList.remove('carrito-sheet--volviendo'), 250);
    }
  };

  handle.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    arrastrando = true;
    arrancoY = e.clientY;
    arrancoT = performance.now();
    alturaSheet = sheet.getBoundingClientRect().height;
    sheet.classList.add('carrito-sheet--arrastrando');
    handle.setPointerCapture(e.pointerId);
  });
  handle.addEventListener('pointermove', mover);
  handle.addEventListener('pointerup', soltar);
  handle.addEventListener('pointercancel', soltar);
}

function renderCarrito(feria, container) {
  const dock = document.getElementById('carrito-dock');
  const sheet = document.getElementById('carrito-sheet');
  const backdrop = document.getElementById('carrito-backdrop');
  if (!dock || !sheet) return;

  const bruto = carrito.reduce((sum, l) => sum + l.precio * (l.tipo === 'producto' ? l.cantidad : 1), 0);
  descuentoActual = Math.min(descuentoActual, bruto); // re-clamp: si el carrito se achicó, el descuento no puede superar el nuevo bruto
  const total = Math.max(0, bruto - descuentoActual);
  const count = carrito.reduce((sum, l) => sum + (l.tipo === 'producto' ? l.cantidad : 1), 0);
  const etiquetaCobrar = `Confirmar venta · ${formatMoney(total)}`;

  // --- Mini-dock: resumen compacto encima de la tab bar (se muestra sólo en Vender con ítems) ---
  dock.classList.toggle('has-items', carrito.length > 0);
  dock.innerHTML = `
    <span class="carrito-dock__resumen">
      <svg class="icon" aria-hidden="true"><use href="#i-vender"/></svg>
      <span class="dock-badge${count !== ultimoCountDock && count > 0 ? ' dock-badge--bump' : ''}">${count}</span>
      <span class="monto">${formatMoney(total)}</span>
    </span>
    <span class="carrito-dock__cta">Cobrar <svg class="icon" aria-hidden="true"><use href="#i-chevron"/></svg></span>
  `;
  ultimoCountDock = count;
  dock.onclick = () => abrirSheet();
  if (backdrop) backdrop.onclick = () => cerrarSheet();

  // --- Hoja: head fijo + body con scroll + footer siempre visible (total y CTA nunca tapados) ---
  const lineas = carrito.map((l, i) => {
    if (l.tipo === 'producto') {
      const fp = feriaProductosActuales.find((f) => f.productos.id === l.productoId);
      const quedan = fp ? fp.productos.stock - cantidadEnCarrito(l.productoId) : 0;
      return `
        <div class="carrito-linea" data-index="${i}">
          <div class="carrito-linea__info">
            <span class="carrito-linea__nombre">${escapeHtml(l.nombre)}</span>
            <span class="carrito-linea__detalle">${detalleLinea(l)}</span>
          </div>
          <div class="stepper" aria-label="Cantidad de ${escapeHtml(l.nombre)}">
            <button type="button" class="stepper__btn" data-action="linea-menos" data-index="${i}" aria-label="Una unidad menos">
              <svg class="icon" aria-hidden="true"><use href="#i-menos"/></svg>
            </button>
            <span class="stepper__qty stepper__qty--editable" data-action="editar-cantidad" data-index="${i}" role="button" tabindex="0" aria-label="Cambiar cantidad de ${escapeHtml(l.nombre)}">${l.cantidad}</span>
            <button type="button" class="stepper__btn" data-action="linea-mas" data-index="${i}" aria-label="Una unidad más" ${quedan <= 0 ? 'disabled' : ''}>
              <svg class="icon" aria-hidden="true"><use href="#i-mas"/></svg>
            </button>
          </div>
          <span class="carrito-linea__total monto">${formatMoney(l.precio * l.cantidad)}</span>
        </div>`;
    }
    return `
      <div class="carrito-linea" data-index="${i}">
        <div class="carrito-linea__info">
          <span class="carrito-linea__nombre">${escapeHtml(l.nombre)}</span>
          <span class="carrito-linea__detalle">${escapeHtml(detalleLinea(l))}</span>
        </div>
        <button type="button" class="btn-accion btn-accion--sm" data-action="quitar-linea" data-index="${i}" title="Quitar del carrito">
          <svg class="icon" aria-hidden="true"><use href="#i-quitar"/></svg> Quitar
        </button>
        <span class="carrito-linea__total monto">${formatMoney(l.precio)}</span>
      </div>`;
  }).join('') || '<p class="list-empty">Carrito vacío</p>';

  sheet.innerHTML = `
    <div class="carrito-sheet__handle" aria-hidden="true"></div>
    <div class="sheet__head">
      <h3>Carrito</h3>
      <button type="button" class="btn-accion btn-accion--sm" id="btn-cerrar-sheet" aria-label="Cerrar carrito">
        <svg class="icon" aria-hidden="true"><use href="#i-cerrar"/></svg> Cerrar
      </button>
    </div>
    <div class="sheet__body">
      <div class="carrito-lineas">${lineas}</div>
      <label class="field carrito-descuento">
        <span class="field__label">Descuento en pesos (opcional)</span>
        <input type="number" id="input-descuento" class="input" min="0" step="1" inputmode="numeric" value="${descuentoActual || ''}" placeholder="0" />
      </label>
    </div>
    <div class="sheet__footer">
      <div class="carrito-resumen">
        ${descuentoActual ? `
          <div class="linea-resumen"><span>Subtotal</span><span class="monto">${formatMoney(bruto)}</span></div>
          <div class="linea-resumen linea-resumen--desc"><span>Descuento</span><span class="monto">−${formatMoney(descuentoActual)}</span></div>` : ''}
        <div class="linea-resumen linea-resumen--total"><span>Total</span><span class="monto">${formatMoney(total)}</span></div>
      </div>
      <div class="carrito-pago">
        <span class="field__label">¿Cómo te paga?</span>
        <div class="segmented" role="group" aria-label="Método de pago">
          <button type="button" class="segmented__item ${metodoPagoActual === 'efectivo' ? 'is-active' : ''}" data-metodo="efectivo">💵 Efectivo</button>
          <button type="button" class="segmented__item ${metodoPagoActual === 'transferencia' ? 'is-active' : ''}" data-metodo="transferencia">📲 Transferencia</button>
        </div>
      </div>
      <div class="vuelto ${metodoPagoActual === 'efectivo' ? '' : 'hidden'}" id="vuelto-bloque">
        <label class="field">
          <span class="field__label">¿Con cuánto te paga? (para calcular el vuelto)</span>
          <input type="number" id="input-paga-con" class="input" min="0" inputmode="numeric" placeholder="Ej: 20000" value="${pagaConActual}" />
        </label>
        <p class="vuelto__resultado" id="vuelto-resultado" role="status"></p>
      </div>
      <div class="carrito-actions">
        <button class="btn btn--secondary" id="btn-vaciar-carrito" ${carrito.length === 0 ? 'disabled' : ''}>Vaciar</button>
        <button class="btn btn--primary" id="btn-confirmar-venta" ${carrito.length === 0 ? 'disabled' : ''}>${etiquetaCobrar}</button>
      </div>
    </div>
  `;

  sheet.querySelector('#btn-cerrar-sheet').addEventListener('click', () => cerrarSheet());

  sheet.querySelectorAll('[data-action="quitar-linea"]').forEach((btn) => {
    btn.addEventListener('click', () => quitarLineaConDeshacer(feria, container, Number(btn.dataset.index)));
  });

  // Steppers: mutan la cantidad y re-renderizan; el foco vuelve al mismo botón
  // para que con teclado no salte al body tras el re-render.
  sheet.querySelectorAll('[data-action="linea-menos"], [data-action="linea-mas"]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const i = Number(btn.dataset.index);
      const accion = btn.dataset.action;
      const linea = carrito[i];
      if (!linea || linea.tipo !== 'producto') return;
      if (accion === 'linea-mas') {
        const fp = feriaProductosActuales.find((f) => f.productos.id === linea.productoId);
        const quedan = fp ? fp.productos.stock - cantidadEnCarrito(linea.productoId) : 0;
        if (quedan <= 0) { toast('No queda más stock disponible de ese producto'); return; }
        linea.cantidad += 1;
      } else {
        linea.cantidad -= 1;
        if (linea.cantidad <= 0) { quitarLineaConDeshacer(feria, container, i); return; } // ya cierra/refresca; no queda botón al que devolver el foco
      }
      refrescarVenta(feria, container);
      const mismo = sheet.querySelector(`[data-action="${accion}"][data-index="${i}"]`);
      if (mismo && !mismo.disabled) mismo.focus();
    });
  });

  // Cantidad por teclado: tocar el número abre un prompt numérico en vez de tocar +/- varias veces.
  sheet.querySelectorAll('[data-action="editar-cantidad"]').forEach((span) => {
    const activar = async () => {
      const i = Number(span.dataset.index);
      const linea = carrito[i];
      if (!linea || linea.tipo !== 'producto') return;
      const fp = feriaProductosActuales.find((f) => f.productos.id === linea.productoId);
      const quedan = fp ? fp.productos.stock - cantidadEnCarrito(linea.productoId) : 0; // mismo cálculo que usan los botones +/-
      const maxPermitido = linea.cantidad + Math.max(0, quedan);
      const val = await promptDialog(`¿Cuántas unidades de "${linea.nombre}"?`, { tipo: 'number', value: String(linea.cantidad), okLabel: 'Actualizar' });
      if (val === null) return; // canceló
      const nueva = Math.trunc(Number(val));
      if (!nueva || nueva <= 0) { quitarLineaConDeshacer(feria, container, i); return; }
      linea.cantidad = Math.min(nueva, maxPermitido);
      refrescarVenta(feria, container);
    };
    span.addEventListener('click', activar);
    span.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); activar(); }
    });
  });

  wireDragDismiss(sheet);

  sheet.querySelector('#btn-vaciar-carrito').addEventListener('click', async () => {
    if (carrito.length === 0) return;
    const ok = await confirmDialog('¿Vaciar el carrito? Se quitan todos los productos que agregaste.');
    if (!ok) return;
    carrito = [];
    pagaConActual = '';
    cerrarSheet();
    refrescarVenta(feria, container);
  });

  // Método de pago: se togglea sin re-render (no roba foco); el bloque de vuelto
  // sólo tiene sentido en efectivo.
  sheet.querySelectorAll('.segmented__item').forEach((btn) => {
    btn.addEventListener('click', () => {
      metodoPagoActual = btn.dataset.metodo;
      sheet.querySelectorAll('.segmented__item').forEach((b) => b.classList.toggle('is-active', b.dataset.metodo === metodoPagoActual));
      sheet.querySelector('#vuelto-bloque').classList.toggle('hidden', metodoPagoActual !== 'efectivo');
      persistirCarrito(feria.id);
    });
  });

  const inputDescuento = sheet.querySelector('#input-descuento');
  if (inputDescuento) {
    inputDescuento.addEventListener('change', () => {
      const val = Math.max(0, Number(inputDescuento.value) || 0);
      descuentoActual = Math.min(val, bruto);
      persistirCarrito(feria.id);
      renderCarrito(feria, container); // change dispara en blur: re-render seguro, no roba foco
    });
  }

  // Calculadora de vuelto: 100% cliente, actualiza en vivo SIN re-render (conserva el foco).
  const inputPagaCon = sheet.querySelector('#input-paga-con');
  const vueltoResultado = sheet.querySelector('#vuelto-resultado');
  const actualizarVuelto = () => {
    pagaConActual = inputPagaCon.value;
    const paga = Number(inputPagaCon.value);
    if (inputPagaCon.value === '' || !Number.isFinite(paga)) {
      vueltoResultado.textContent = '';
      vueltoResultado.className = 'vuelto__resultado';
      return;
    }
    if (paga >= total) {
      vueltoResultado.textContent = `Vuelto: ${formatMoney(paga - total)}`;
      vueltoResultado.className = 'vuelto__resultado vuelto__resultado--ok';
    } else {
      vueltoResultado.textContent = `Falta ${formatMoney(total - paga)}`;
      vueltoResultado.className = 'vuelto__resultado vuelto__resultado--falta';
    }
  };
  inputPagaCon.addEventListener('input', actualizarVuelto);
  actualizarVuelto();

  sheet.querySelector('#btn-confirmar-venta').addEventListener('click', async () => {
    if (!isOnline()) {
      toast('Sin conexión — no se puede confirmar la venta ahora');
      return;
    }

    const btn = sheet.querySelector('#btn-confirmar-venta');
    btn.disabled = true;
    btn.textContent = 'Confirmando...';

    // idempotencia: un id estable por carrito; si reintentás, no se cobra dos veces
    if (!clientVentaIdPendiente) clientVentaIdPendiente = uuid();

    const items = carrito.map((l) => {
      if (l.tipo === 'producto') return { tipo: 'producto', producto_id: l.productoId, cantidad: l.cantidad };
      if (l.tipo === 'combo') return { tipo: 'combo', combo_id: l.comboId, producto_ids: l.productos.map((p) => p.id) };
      return { tipo: 'manual', nombre: l.nombre, precio: l.precio };
    });

    const controller = new AbortController();
    let timedOut = false;
    const timeout = setTimeout(() => { timedOut = true; controller.abort(); }, 15000);

    let data, error;
    try {
      ({ data, error } = await supabase
        .rpc('confirmar_venta', {
          p_feria_id: feria.id,
          p_items: items,
          p_metodo_pago: metodoPagoActual,
          p_descuento: descuentoActual,
          p_client_venta_id: clientVentaIdPendiente,
        })
        .abortSignal(controller.signal));
    } catch (e) {
      // postgrest-js normalmente RESUELVE con { error } ante un abort (no rechaza);
      // este catch es un respaldo por si alguna versión/entorno sí rechaza.
      error = e;
    } finally {
      clearTimeout(timeout);
    }

    btn.disabled = false;
    btn.textContent = etiquetaCobrar;

    // `timedOut` es la señal determinística de nuestro propio timeout (no depende de
    // matchear el texto del error); el regex cubre además un abort de otra fuente.
    if (timedOut || (error && /abort/i.test(error.message || ''))) {
      toast('La red está lenta. Tocá de nuevo para reintentar — no se cobra dos veces.');
      return;
    }
    if (error) {
      toast(`No se pudo confirmar la venta: ${error.message}`, { tipo: 'error' });
      return;
    }

    carrito = [];
    clientVentaIdPendiente = null;
    metodoPagoActual = 'efectivo';
    descuentoActual = 0;
    pagaConActual = '';
    persistirCarrito(feria.id);
    cerrarSheet();
    vibrar();
    if (window.confetti) window.confetti({ particleCount: 120, spread: 80, origin: { y: 0.7 } });
    toast(`¡Venta registrada! 🎉 Total: ${formatMoney(data[0].total)}`, { tipo: 'exito' });
    loadAndRender(feria, container);
  });
}

async function agregarComboAlCarrito(combo, feriaProductos, feria, container) {
  const disponibles = feriaProductos
    .map((fp) => fp.productos)
    .filter((p) => p.stock - cantidadEnCarrito(p.id) > 0);

  if (disponibles.length < combo.cantidad) {
    toast(`No hay suficientes productos con stock para este combo (necesita ${combo.cantidad})`);
    return;
  }

  const seleccionados = await seleccionarProductosCombo(combo, disponibles);
  if (!seleccionados) return;

  carrito.push({ tipo: 'combo', comboId: combo.id, nombre: combo.nombre, precio: combo.precio, productos: seleccionados });
  refrescarVenta(feria, container);
}

async function seleccionarProductosCombo(combo, disponibles) {
  const seleccion = new Set();
  const { dialogo, cerrar, cerrado } = abrirModal({
    titulo: combo.nombre,
    claseExtra: 'modal--combo',
    contenidoHTML: '<div id="combo-body"></div>',
  });
  const body = dialogo.querySelector('#combo-body');

  const render = () => {
    body.innerHTML = `
      <p class="card__hint">Elegí los ${combo.cantidad} productos del combo (llevás ${seleccion.size} de ${combo.cantidad})</p>
      <div class="combo-picker-grid">
        ${disponibles.map((p) => `
          <button type="button" class="combo-picker-item ${seleccion.has(p.id) ? 'selected' : ''}" data-id="${p.id}">
            ${p.imagen_url ? `<img src="${p.imagen_url}" alt="" />` : '<span class="combo-picker-item__sin-foto" aria-hidden="true">🌸</span>'}
            <span class="combo-picker-item__nombre">${escapeHtml(p.nombre)}</span>
            ${p.descripcion ? `<span class="combo-picker-item__desc">${escapeHtml(p.descripcion)}</span>` : ''}
          </button>
        `).join('')}
      </div>
      <div class="modal-actions">
        <button type="button" class="btn btn--secondary" data-action="cancelar">Cancelar</button>
        <button type="button" class="btn btn--primary" data-action="confirmar" ${seleccion.size !== combo.cantidad ? 'disabled' : ''}>Agregar al carrito</button>
      </div>
    `;
  };
  render();

  // Delegación sobre el diálogo: el body se re-renderiza en cada toque.
  dialogo.addEventListener('click', (e) => {
    const item = e.target.closest('[data-id]');
    if (item) {
      const id = item.dataset.id;
      if (seleccion.has(id)) seleccion.delete(id);
      else if (seleccion.size < combo.cantidad) seleccion.add(id);
      render();
      return;
    }
    const action = e.target.closest('[data-action]')?.dataset.action;
    if (action === 'cancelar') cerrar(null);
    if (action === 'confirmar' && seleccion.size === combo.cantidad) {
      cerrar(disponibles.filter((p) => seleccion.has(p.id)).map((p) => ({ id: p.id, nombre: p.nombre })));
    }
  });

  const val = await cerrado;
  return Array.isArray(val) ? val : null;
}

async function cargarRanking(feria) {
  const { data, error } = await supabase
    .from('venta_items')
    .select('producto_id, cantidad, ventas!inner(feria_id, anulada)')
    .eq('ventas.feria_id', feria.id)
    .eq('ventas.anulada', false)
    .eq('tipo', 'producto')
    .not('producto_id', 'is', null);
  if (error) console.warn('No se pudo cargar el ranking de más vendidos:', error.message);
  const conteo = {};
  (data || []).forEach((i) => { conteo[i.producto_id] = (conteo[i.producto_id] || 0) + i.cantidad; });
  rankingCongelado = Object.entries(conteo).sort((a, b) => b[1] - a[1]).map(([id]) => id);
}
