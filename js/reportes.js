import { supabase } from './supabaseClient.js';

export function initReportes(feria) {
  const container = document.getElementById('tab-reportes');
  container.innerHTML = '<p>Cargando reportes...</p>';
  render(feria, container);
  return () => {};
}

async function render(feria, container) {
  const { data: ventas, error: ventasError } = await supabase
    .from('ventas').select('*').eq('feria_id', feria.id).eq('anulada', false).order('created_at', { ascending: false });

  const { data: items, error: itemsError } = await supabase
    .from('venta_items')
    .select('*, ventas!inner(feria_id, anulada)')
    .eq('ventas.feria_id', feria.id)
    .eq('ventas.anulada', false);

  const { data: comboItems } = await supabase
    .from('venta_item_combo_productos')
    .select('producto_nombre, venta_items!inner(venta_id, ventas!inner(feria_id, anulada))')
    .eq('venta_items.ventas.feria_id', feria.id)
    .eq('venta_items.ventas.anulada', false);

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

  renderPorFecha(ventas, items, container.querySelector('#reporte-fechas'));
  renderTopProductos(items, comboItems || [], container.querySelector('#reporte-top-productos'));
  renderPorCategoria(items, container.querySelector('#reporte-categorias'));
}

function renderPorFecha(ventas, items, el) {
  const hoy = new Date().toLocaleDateString('en-CA'); // fecha LOCAL (YYYY-MM-DD), no UTC
  const itemsPorVenta = {};
  items.forEach((i) => {
    (itemsPorVenta[i.venta_id] = itemsPorVenta[i.venta_id] || []).push(i);
  });

  const porFecha = {};
  ventas.forEach((v) => {
    const fecha = new Date(v.created_at).toLocaleDateString('en-CA'); // fecha LOCAL de la venta
    (porFecha[fecha] = porFecha[fecha] || []).push(v);
  });

  const fechas = Object.keys(porFecha).sort().reverse();
  el.innerHTML = fechas.map((fecha) => {
    const ventasDia = porFecha[fecha];
    const totalDia = ventasDia.reduce((s, v) => s + Number(v.total), 0);
    const porMetodo = { efectivo: 0, transferencia: 0, otro: 0 };
    ventasDia.forEach((v) => { porMetodo[v.metodo_pago] = (porMetodo[v.metodo_pago] || 0) + Number(v.total); });
    const esHoy = fecha === hoy;
    const filas = ventasDia.map((v) => {
      const hora = new Date(v.created_at).toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' });
      const desc = (itemsPorVenta[v.id] || []).map((i) => i.tipo === 'producto' ? `${i.producto_nombre} x${i.cantidad}` : i.producto_nombre).join(', ') || '—';
      const metodoIcon = v.metodo_pago === 'efectivo' ? '💵' : v.metodo_pago === 'transferencia' ? '📲' : '🔵';
      return `<div class="venta-fila"><span>${hora} ${metodoIcon}</span><span class="venta-fila__desc">${desc}</span><span>$${v.total}</span></div>`;
    }).join('');
    return `<details class="historial-dia" ${esHoy ? 'open' : ''}>
      <summary>${esHoy ? '⭐ Hoy' : fecha} — $${totalDia} (${ventasDia.length} ventas)</summary>
      <div class="dia-metodos">💵 $${porMetodo.efectivo} · 📲 $${porMetodo.transferencia} · 🔵 $${porMetodo.otro}</div>
      ${filas}
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
