import { supabase } from './supabaseClient.js';
import { escapeHtml, formatMoney, promptDialog } from './ui.js';

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

  const inicioHoy = new Date();
  inicioHoy.setHours(0, 0, 0, 0);
  const { count: anuladasHoy } = await supabase
    .from('ventas')
    .select('id', { count: 'exact', head: true })
    .eq('feria_id', feria.id)
    .eq('anulada', true)
    .gte('created_at', inicioHoy.toISOString());

  container.innerHTML = `
    <section class="card" id="reporte-cierre">
      <h2>🧾 Cerrar caja (hoy)</h2>
      <p class="card__hint">Es una calculadora de arqueo: compará el efectivo esperado con lo que contás en la caja. No corta las ventas ni guarda un cierre — podés revisarla las veces que quieras.</p>
      <div id="cierre-content"></div>
    </section>
    <section class="card">
      <h2>Por fecha</h2>
      <div id="reporte-fechas"></div>
    </section>
    <section class="card">
      <h2>Productos más vendidos</h2>
      <div id="reporte-top-productos"></div>
    </section>
    <section class="card">
      <h2>Por categoría de precio</h2>
      <p class="card__hint">Suma de ventas por categoría, antes de descuentos. Para el dinero real de la caja mirá "Cerrar caja".</p>
      <div id="reporte-categorias"></div>
    </section>
  `;

  renderCierre(ventas, anuladasHoy || 0, container.querySelector('#cierre-content'));
  renderPorFecha(feria, container, ventas, items, container.querySelector('#reporte-fechas'));
  renderTopProductos(items, comboItems || [], container.querySelector('#reporte-top-productos'));
  renderPorCategoria(items, container.querySelector('#reporte-categorias'));
}

function renderCierre(ventas, anuladasHoy, el) {
  const hoy = new Date().toLocaleDateString('en-CA'); // fecha LOCAL, no UTC (si no, la caja de una feria nocturna no cuadra)
  const ventasHoy = ventas.filter((v) => new Date(v.created_at).toLocaleDateString('en-CA') === hoy);
  const por = { efectivo: 0, transferencia: 0, otro: 0 };
  ventasHoy.forEach((v) => { por[v.metodo_pago] = (por[v.metodo_pago] || 0) + Number(v.total); });

  el.innerHTML = `
    <div class="cierre-linea"><span>💵 Esperado en efectivo</span><strong>${formatMoney(por.efectivo)}</strong></div>
    <div class="cierre-linea"><span>Contado (lo que hay en la caja)</span><input type="number" id="cierre-contado" min="0" placeholder="$" /></div>
    <div class="cierre-linea" id="cierre-diferencia-row"><span>Diferencia</span><strong id="cierre-diferencia">—</strong></div>
    <hr class="cierre-hr" />
    <div class="cierre-linea"><span>📲 Transferencias</span><strong>${formatMoney(por.transferencia)}</strong></div>
    <div class="cierre-linea"><span>🔵 Otro (QR)</span><strong>${formatMoney(por.otro)}</strong></div>
    <div class="cierre-linea"><span>Ventas del día</span><strong>${ventasHoy.length}</strong></div>
    <div class="cierre-linea"><span>Anuladas hoy</span><strong>${anuladasHoy}</strong></div>
    <button class="btn" id="btn-cerrar-caja">Cerrar caja 🎉</button>
  `;

  const contado = el.querySelector('#cierre-contado');
  const difEl = el.querySelector('#cierre-diferencia');
  contado.addEventListener('input', () => {
    if (contado.value === '') { difEl.textContent = '—'; difEl.className = ''; return; }
    const dif = Number(contado.value) - por.efectivo;
    difEl.textContent = `${dif === 0 ? '✓ ' : ''}${formatMoney(dif)}`;
    difEl.className = dif === 0 ? 'cierre-ok' : 'cierre-diff';
  });

  el.querySelector('#btn-cerrar-caja').addEventListener('click', () => {
    const dif = contado.value === '' ? null : Number(contado.value) - por.efectivo;
    if (window.confetti) window.confetti({ particleCount: 160, spread: 90, origin: { y: 0.6 } });
    if (dif === 0) {
      import('./ui.js').then((m) => m.toast(`¡Cuadraste! 🎉 ${formatMoney(por.efectivo)} en efectivo`));
    } else if (dif == null) {
      import('./ui.js').then((m) => m.toast('Caja cerrada 🎉'));
    } else {
      import('./ui.js').then((m) => m.toast(`Cerrada — diferencia de ${formatMoney(dif)} en efectivo`));
    }
  });
}

function renderPorFecha(feria, containerRaiz, ventas, items, el) {
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
      const desc = (itemsPorVenta[v.id] || []).map((i) => i.tipo === 'producto' ? `${escapeHtml(i.producto_nombre)} x${i.cantidad}` : escapeHtml(i.producto_nombre)).join(', ') || '—';
      const metodoIcon = v.metodo_pago === 'efectivo' ? '💵' : v.metodo_pago === 'transferencia' ? '📲' : '🔵';
      const anularBtn = esHoy ? `<button class="btn-accion btn-accion--peligro btn-accion--sm" data-action="anular-venta" data-id="${v.id}" title="Repone stock e insumos y marca la venta como anulada">↩️ Anular</button>` : '';
      return `<div class="venta-fila"><span>${hora} ${metodoIcon}</span><span class="venta-fila__desc">${desc}</span><span>${formatMoney(v.total)}</span>${anularBtn}</div>`;
    }).join('');
    return `<details class="historial-dia" ${esHoy ? 'open' : ''}>
      <summary>${esHoy ? '⭐ Hoy' : fecha} — ${formatMoney(totalDia)} (${ventasDia.length} ventas)</summary>
      <div class="dia-metodos">💵 ${formatMoney(porMetodo.efectivo)} · 📲 ${formatMoney(porMetodo.transferencia)} · 🔵 ${formatMoney(porMetodo.otro)}</div>
      ${filas}
    </details>`;
  }).join('') || '<p class="list-empty">Todavía no hay ventas</p>';

  el.querySelectorAll('[data-action="anular-venta"]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const { confirmDialog } = await import('./ui.js');
      const ok = await confirmDialog('¿Anular esta venta? Se repone el stock y los insumos, y queda registrada como anulada.', { peligro: true });
      if (!ok) return;
      const motivo = (await promptDialog('Motivo de la anulación (opcional):', { okLabel: 'Anular venta', placeholder: 'Ej: se equivocó de producto' })) || null;
      const { error } = await supabase.rpc('anular_venta', { p_venta_id: btn.dataset.id, p_motivo: motivo });
      const { toast } = await import('./ui.js');
      if (error) { toast(`No se pudo anular: ${error.message}`); return; }
      toast('Venta anulada — stock repuesto');
      render(feria, containerRaiz); // recargar todo el reporte
    });
  });
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
  el.innerHTML = ranking.map(([nombre, cant]) => `<div class="row"><span>${escapeHtml(nombre)}</span><span>${cant} vendidos</span></div>`).join('')
    || '<p class="list-empty">Todavía no hay ventas</p>';
}

function renderPorCategoria(items, el) {
  const porCategoria = {};
  items.forEach((i) => {
    const clave = i.tipo === 'combo' ? 'Combos' : (i.categoria_precio_nombre || 'Sin categoría');
    porCategoria[clave] = (porCategoria[clave] || 0) + i.precio_unitario * i.cantidad;
  });
  el.innerHTML = Object.entries(porCategoria).map(([nombre, total]) => `<div class="row"><span>${escapeHtml(nombre)}</span><span>${formatMoney(total)}</span></div>`).join('')
    || '<p class="list-empty">Todavía no hay ventas</p>';
}
