import { supabase } from './supabaseClient.js';
import { confirmDialog, toast } from './ui.js';

let realtimeChannel = null;
let carrito = []; // { tipo: 'producto', productoId, nombre, precio, cantidad } | { tipo: 'combo', comboId, nombre, precio, productos: [{id, nombre}] }

export function initVender(feria) {
  carrito = [];
  const container = document.getElementById('tab-vender');
  container.innerHTML = '<p>Cargando productos...</p>';

  loadAndRender(feria, container);

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
    supabase.from('feria_productos').select('categoria_precio_id, precio_override, productos(id, nombre, imagen_url, stock), categorias_precio(precio)').eq('feria_id', feria.id),
    supabase.from('combos').select('*').eq('feria_id', feria.id).eq('activo', true).order('nombre'),
  ]);

  if (prodError || comboError) {
    container.innerHTML = '<p class="error">No se pudieron cargar los productos</p>';
    return;
  }

  render(feria, feriaProductos || [], combos || [], container);
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

  const grid = document.createElement('div');
  grid.className = 'productos-grid';
  feriaProductos.forEach((fp) => {
    const p = fp.productos;
    const precio = precioEfectivo(fp);
    const disponible = p.stock - cantidadEnCarrito(p.id);
    const card = document.createElement('button');
    card.className = 'producto-card';
    card.disabled = disponible <= 0 || precio == null;
    card.innerHTML = `
      ${p.imagen_url ? `<img src="${p.imagen_url}" alt="${p.nombre}" />` : '<div class="producto-card__sin-foto">🌸</div>'}
      <span class="producto-card__nombre">${p.nombre}</span>
      <span class="producto-card__precio">${precio != null ? `$${precio}` : 'sin precio'}</span>
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
  const viejo = container.querySelector('#carrito-panel');
  const nuevo = renderCarrito(feria, container);
  if (viejo) viejo.replaceWith(nuevo);
  loadAndRender(feria, container); // recalcula "disponible" de cada card contra el carrito actualizado
}

function renderCarrito(feria, container) {
  const panel = document.createElement('div');
  panel.id = 'carrito-panel';
  panel.className = 'carrito-panel';

  const total = carrito.reduce((sum, l) => sum + l.precio * (l.tipo === 'producto' ? l.cantidad : 1), 0);

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
    <p class="carrito-total">Total: $${total}</p>
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

  panel.querySelector('#btn-confirmar-venta').addEventListener('click', async () => {
    if (!navigator.onLine) {
      toast('Sin conexión — no se puede confirmar la venta ahora');
      return;
    }

    const total = carrito.reduce((sum, l) => sum + l.precio * (l.tipo === 'producto' ? l.cantidad : 1), 0);
    const ok = await confirmDialog(`¿Confirmar venta por un total de $${total}?`);
    if (!ok) return;

    const items = carrito.map((l) => l.tipo === 'producto'
      ? { tipo: 'producto', producto_id: l.productoId, cantidad: l.cantidad }
      : { tipo: 'combo', combo_id: l.comboId, producto_ids: l.productos.map((p) => p.id) }
    );

    const { data, error } = await supabase.rpc('confirmar_venta', { p_feria_id: feria.id, p_items: items });

    if (error) {
      toast(`No se pudo confirmar la venta: ${error.message}`);
      return;
    }

    carrito = [];
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
