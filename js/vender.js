import { supabase } from './supabaseClient.js';
import { confirmDialog, toast } from './ui.js';
import { isOnline } from './connection.js';

let realtimeChannel = null;
let carrito = []; // { tipo: 'producto', productoId, nombre, precio, cantidad } | { tipo: 'combo', comboId, nombre, precio, productos: [{id, nombre}] }
let metodoPagoActual = 'efectivo';
let clientVentaIdPendiente = null;
let descuentoActual = 0;
let filtroBusqueda = '';
let rankingCongelado = []; // ids de producto ordenados por más vendidos, calculado 1 vez por sesión de feria
let feriaProductosActuales = [];
let combosActuales = [];

export function initVender(feria) {
  carrito = [];
  metodoPagoActual = 'efectivo';
  clientVentaIdPendiente = null;
  descuentoActual = 0;
  filtroBusqueda = '';
  rankingCongelado = [];
  feriaProductosActuales = [];
  combosActuales = [];
  const container = document.getElementById('tab-vender');
  container.innerHTML = '<p>Cargando productos...</p>';

  // initVender NO puede ser async (devuelve la función de cleanup a nav.js), así que
  // no se puede `await`. Se re-renderiza cuando el ranking resuelve, para que el orden
  // "más vendidos arriba" se aplique aunque el usuario no interactúe.
  cargarRanking(feria).then(() => loadAndRender(feria, container));

  realtimeChannel = supabase
    .channel(`vender-${feria.id}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'productos' }, () => loadAndRender(feria, container))
    .subscribe();

  return () => {
    if (realtimeChannel) {
      supabase.removeChannel(realtimeChannel);
      realtimeChannel = null;
    }
  };
}

async function loadAndRender(feria, container) {
  const [{ data: feriaProductos, error: prodError }, { data: combos, error: comboError }] = await Promise.all([
    supabase.from('feria_productos').select('id, categoria_precio_id, precio_override, productos(id, nombre, imagen_url, stock), categorias_precio(precio)').eq('feria_id', feria.id),
    supabase.from('combos').select('*').eq('feria_id', feria.id).eq('activo', true).order('nombre'),
  ]);

  if (prodError || comboError) {
    container.innerHTML = '<p class="error">No se pudieron cargar los productos</p>';
    return;
  }

  feriaProductosActuales = feriaProductos || [];
  combosActuales = combos || [];
  render(feria, feriaProductosActuales, combosActuales, container);
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

function render(feria, feriaProductos, combos, container) {
  container.innerHTML = '';

  const buscador = document.createElement('input');
  buscador.className = 'vender-buscador';
  buscador.type = 'search';
  buscador.placeholder = '🔎 Buscar producto...';
  buscador.value = filtroBusqueda;
  buscador.addEventListener('input', () => {
    filtroBusqueda = buscador.value;
    const scroll = window.scrollY;
    render(feria, feriaProductos, combos, container);
    window.scrollTo(0, scroll);
    container.querySelector('.vender-buscador')?.focus();
  });
  container.appendChild(buscador);

  if (combos.length > 0) {
    const combosRow = document.createElement('div');
    combosRow.className = 'combos-row';
    combos.forEach((combo) => {
      const btn = document.createElement('button');
      btn.className = 'combo-btn';
      btn.textContent = `${combo.nombre} — $${combo.precio}`;
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
  const visibles = filtroBusqueda
    ? ordenados.filter((fp) => fp.productos.nombre.toLowerCase().includes(filtroBusqueda.toLowerCase()))
    : ordenados;

  const grid = document.createElement('div');
  grid.className = 'productos-grid';
  visibles.forEach((fp) => {
    const p = fp.productos;
    const precio = precioEfectivo(fp);
    const disponible = p.stock - cantidadEnCarrito(p.id);
    const card = document.createElement('button');
    card.className = 'producto-card';
    if (precio == null) {
      card.classList.add('producto-card--sin-precio');
      card.innerHTML = `
        ${p.imagen_url ? `<img src="${p.imagen_url}" alt="${p.nombre}" />` : '<div class="producto-card__sin-foto">🌸</div>'}
        <span class="producto-card__nombre">${p.nombre}</span>
        <span class="producto-card__poner-precio">Tocar para poner precio</span>
      `;
      card.addEventListener('click', async () => {
        const val = prompt(`Precio de "${p.nombre}" en esta feria:`);
        if (val === null) return; // el usuario canceló el prompt
        const precio = Number(val);
        if (!Number.isFinite(precio) || precio <= 0) { toast('Poné un precio válido mayor a 0.'); return; }
        const { error } = await supabase.from('feria_productos').update({ precio_override: precio }).eq('id', fp.id);
        if (error) { toast('No se pudo guardar el precio. Probá de nuevo.'); return; }
        loadAndRender(feria, container);
      });
      grid.appendChild(card);
      return; // continúa el forEach
    }
    card.disabled = disponible <= 0;
    card.innerHTML = `
      ${p.imagen_url ? `<img src="${p.imagen_url}" alt="${p.nombre}" />` : '<div class="producto-card__sin-foto">🌸</div>'}
      <span class="producto-card__nombre">${p.nombre}</span>
      <span class="producto-card__precio">$${precio}</span>
      <span class="producto-card__stock">${disponible > 0 ? `Disponible: ${disponible}` : 'Sin stock'}</span>
    `;
    card.addEventListener('click', () => agregarProductoAlCarrito(p, precio, feria, container));
    grid.appendChild(card);
  });
  container.appendChild(grid);

  container.appendChild(renderCarrito(feria, container));
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
  refrescarCarrito(feria, container);
}

function refrescarCarrito(feria, container) {
  clientVentaIdPendiente = null; // el carrito cambió => nueva venta lógica
  render(feria, feriaProductosActuales, combosActuales, container); // recalcula "Disponible" en cliente, sin round-trip
}

function renderCarrito(feria, container) {
  const panel = document.createElement('div');
  panel.id = 'carrito-panel';
  panel.className = 'carrito-panel';

  const bruto = carrito.reduce((sum, l) => sum + l.precio * (l.tipo === 'producto' ? l.cantidad : 1), 0);
  descuentoActual = Math.min(descuentoActual, bruto); // re-clamp: si el carrito se achicó, el descuento no puede superar el nuevo bruto
  const total = Math.max(0, bruto - descuentoActual);

  panel.innerHTML = `
    <h3>🛒 Carrito</h3>
    <div class="carrito-lineas">
      ${carrito.map((l, i) => `
        <div class="carrito-linea" data-index="${i}">
          <span>${l.tipo === 'producto' ? `${l.nombre} x${l.cantidad}` : l.nombre} — $${l.precio * (l.tipo === 'producto' ? l.cantidad : 1)}</span>
          <button class="btn-icon" data-action="quitar-linea" data-index="${i}">🗑️</button>
        </div>
      `).join('') || '<p class="inv-empty">Carrito vacío</p>'}
    </div>
    <div class="carrito-descuento">
      <label>Descuento $ <input type="number" id="input-descuento" min="0" step="1" value="${descuentoActual || ''}" placeholder="0" /></label>
    </div>
    <p class="carrito-total">Total: $${total}${descuentoActual ? ` <s>$${bruto}</s>` : ''}</p>
    <div class="carrito-pago">
      <span>Pago:</span>
      ${['efectivo', 'transferencia', 'otro'].map((m) => `
        <button type="button" class="pago-btn ${metodoPagoActual === m ? 'active' : ''}" data-metodo="${m}">
          ${m === 'efectivo' ? '💵 Efectivo' : m === 'transferencia' ? '📲 Transfer' : '🔵 Otro'}
        </button>
      `).join('')}
    </div>
    <div class="carrito-actions">
      <button class="btn btn--secondary" id="btn-vaciar-carrito" ${carrito.length === 0 ? 'disabled' : ''}>Vaciar</button>
      <button class="btn" id="btn-confirmar-venta" ${carrito.length === 0 ? 'disabled' : ''}>Confirmar venta</button>
    </div>
  `;

  panel.querySelectorAll('[data-action="quitar-linea"]').forEach((btn) => {
    btn.addEventListener('click', () => {
      carrito.splice(Number(btn.dataset.index), 1);
      refrescarCarrito(feria, container);
    });
  });

  panel.querySelector('#btn-vaciar-carrito').addEventListener('click', () => {
    carrito = [];
    refrescarCarrito(feria, container);
  });

  panel.querySelectorAll('.pago-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      metodoPagoActual = btn.dataset.metodo;
      panel.querySelectorAll('.pago-btn').forEach((b) => b.classList.toggle('active', b.dataset.metodo === metodoPagoActual));
    });
  });

  const inputDescuento = panel.querySelector('#input-descuento');
  if (inputDescuento) {
    inputDescuento.addEventListener('change', () => {
      const val = Math.max(0, Number(inputDescuento.value) || 0);
      descuentoActual = Math.min(val, bruto);
      const viejo = container.querySelector('#carrito-panel');
      const nuevo = renderCarrito(feria, container);
      if (viejo) viejo.replaceWith(nuevo);
    });
  }

  panel.querySelector('#btn-confirmar-venta').addEventListener('click', async () => {
    if (!isOnline()) {
      toast('Sin conexión — no se puede confirmar la venta ahora');
      return;
    }

    const btn = panel.querySelector('#btn-confirmar-venta');
    btn.disabled = true;
    btn.textContent = 'Confirmando...';

    // idempotencia: un id estable por carrito; si reintentás, no se cobra dos veces
    if (!clientVentaIdPendiente) clientVentaIdPendiente = crypto.randomUUID();

    const items = carrito.map((l) => l.tipo === 'producto'
      ? { tipo: 'producto', producto_id: l.productoId, cantidad: l.cantidad }
      : { tipo: 'combo', combo_id: l.comboId, producto_ids: l.productos.map((p) => p.id) }
    );

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
    btn.textContent = 'Confirmar venta';

    // `timedOut` es la señal determinística de nuestro propio timeout (no depende de
    // matchear el texto del error); el regex cubre además un abort de otra fuente.
    if (timedOut || (error && /abort/i.test(error.message || ''))) {
      toast('La red está lenta. Tocá de nuevo para reintentar — no se cobra dos veces.');
      return;
    }
    if (error) {
      toast(`No se pudo confirmar la venta: ${error.message}`);
      return;
    }

    carrito = [];
    clientVentaIdPendiente = null;
    metodoPagoActual = 'efectivo';
    descuentoActual = 0;
    if (window.confetti) window.confetti({ particleCount: 120, spread: 80, origin: { y: 0.7 } });
    toast(`¡Venta registrada! 🎉 Total: $${data[0].total}`);
    loadAndRender(feria, container);
  });

  return panel;
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
  refrescarCarrito(feria, container);
}

function seleccionarProductosCombo(combo, disponibles) {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    const seleccion = new Set();

    function render() {
      overlay.innerHTML = `
        <div class="modal modal--combo">
          <p>Elegí ${combo.cantidad} productos para "${combo.nombre}" (${seleccion.size}/${combo.cantidad})</p>
          <div class="combo-picker-grid">
            ${disponibles.map((p) => `
              <button class="combo-picker-item ${seleccion.has(p.id) ? 'selected' : ''}" data-id="${p.id}">${p.nombre}</button>
            `).join('')}
          </div>
          <div class="modal-actions">
            <button class="btn btn--secondary" data-action="cancelar">Cancelar</button>
            <button class="btn" data-action="confirmar" ${seleccion.size !== combo.cantidad ? 'disabled' : ''}>Confirmar</button>
          </div>
        </div>
      `;
    }

    render();
    document.body.appendChild(overlay);

    overlay.addEventListener('click', (e) => {
      const id = e.target.dataset.id;
      if (id) {
        if (seleccion.has(id)) seleccion.delete(id);
        else if (seleccion.size < combo.cantidad) seleccion.add(id);
        render();
        return;
      }
      const action = e.target.dataset.action;
      if (action === 'cancelar') {
        document.body.removeChild(overlay);
        resolve(null);
      } else if (action === 'confirmar' && seleccion.size === combo.cantidad) {
        document.body.removeChild(overlay);
        resolve(disponibles.filter((p) => seleccion.has(p.id)).map((p) => ({ id: p.id, nombre: p.nombre })));
      }
    });
  });
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
