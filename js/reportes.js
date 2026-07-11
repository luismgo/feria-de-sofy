import { supabase } from './supabaseClient.js';

export function initReportes(feria) {
  const container = document.getElementById('tab-reportes');
  container.innerHTML = '<p>Cargando reportes...</p>';
  render(feria, container);
  return () => {};
}

async function render(feria, container) {
  const { data: ventas, error: ventasError } = await supabase
    .from('ventas').select('*').eq('feria_id', feria.id).order('created_at', { ascending: false });

  const { data: items, error: itemsError } = await supabase
    .from('venta_items')
    .select('*, ventas!inner(feria_id)')
    .eq('ventas.feria_id', feria.id);

  const { data: comboItems } = await supabase
    .from('venta_item_combo_productos')
    .select('producto_nombre, venta_items!inner(venta_id, ventas!inner(feria_id))')
    .eq('venta_items.ventas.feria_id', feria.id);

  if (ventasError || itemsError) {
    container.innerHTML = '<p class="error">No se pudo cargar el reporte</p>';
    return;
  }

  container.innerHTML = `
    <section class="inv-section">
      <h2>Por fecha</h2>
      <div id="reporte-fechas"></div>
    </section>
    <section class="inv-section">
      <h2>Productos más vendidos</h2>
      <div id="reporte-top-productos"></div>
    </section>
    <section class="inv-section">
      <h2>Por categoría de precio</h2>
      <div id="reporte-categorias"></div>
    </section>
  `;

  renderPorFecha(ventas, container.querySelector('#reporte-fechas'));
  renderTopProductos(items, comboItems || [], container.querySelector('#reporte-top-productos'));
  renderPorCategoria(items, container.querySelector('#reporte-categorias'));
}

function renderPorFecha(ventas, el) {
  const hoy = new Date().toISOString().slice(0, 10);
  const porFecha = {};
  ventas.forEach((v) => {
    const fecha = v.created_at.slice(0, 10);
    if (!porFecha[fecha]) porFecha[fecha] = { total: 0, cantidad: 0 };
    porFecha[fecha].total += Number(v.total);
    porFecha[fecha].cantidad += 1;
  });
  const fechas = Object.keys(porFecha).sort().reverse();
  el.innerHTML = fechas.map((fecha) => {
    const r = porFecha[fecha];
    const esHoy = fecha === hoy;
    return `<details class="historial-dia" ${esHoy ? 'open' : ''}>
      <summary>${esHoy ? '⭐ Hoy' : fecha} — $${r.total} (${r.cantidad} ventas)</summary>
    </details>`;
  }).join('') || '<p class="inv-empty">Todavía no hay ventas</p>';
}

function renderTopProductos(items, comboItems, el) {
  const conteo = {};
  items.filter((i) => i.tipo === 'producto').forEach((i) => {
    conteo[i.producto_nombre] = (conteo[i.producto_nombre] || 0) + i.cantidad;
  });
  comboItems.forEach((ci) => {
    conteo[ci.producto_nombre] = (conteo[ci.producto_nombre] || 0) + 1;
  });
  const ranking = Object.entries(conteo).sort((a, b) => b[1] - a[1]).slice(0, 10);
  el.innerHTML = ranking.map(([nombre, cant]) => `<div class="inv-row"><span>${nombre}</span><span>${cant} vendidos</span></div>`).join('')
    || '<p class="inv-empty">Todavía no hay ventas</p>';
}

function renderPorCategoria(items, el) {
  const porCategoria = {};
  items.forEach((i) => {
    const clave = i.tipo === 'combo' ? 'Combos' : (i.categoria_precio_nombre || 'Sin categoría');
    porCategoria[clave] = (porCategoria[clave] || 0) + i.precio_unitario * i.cantidad;
  });
  el.innerHTML = Object.entries(porCategoria).map(([nombre, total]) => `<div class="inv-row"><span>${nombre}</span><span>$${total}</span></div>`).join('')
    || '<p class="inv-empty">Todavía no hay ventas</p>';
}
