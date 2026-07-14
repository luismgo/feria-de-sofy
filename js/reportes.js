import { supabase } from './supabaseClient.js';
import { escapeHtml, formatMoney, promptDialog, campo, cargando } from './ui.js';

export function initReportes(feria) {
  const container = document.getElementById('tab-reportes');
  container.innerHTML = cargando('Cargando reportes...', { kind: 'reporte' });
  render(feria, container);
  return () => {};
}

function plural(n, uno, varios) {
  return `${n} ${n === 1 ? uno : varios}`;
}

// --- Racha de cajas cuadradas ---
// Clave por feria (mismo patrón que "carrito:${feriaId}" en vender.js) para que
// cada feria lleve su propia racha y no se mezclen entre sí.
function rachaKey(feriaId) {
  return `racha-cuadre:${feriaId}`;
}

function getRacha(feriaId) {
  try { return Number(localStorage.getItem(rachaKey(feriaId))) || 0; } catch { return 0; }
}

// cuadro=true suma +1, cuadro=false resetea a 0. Devuelve la racha resultante.
// Si el storage está bloqueado/lleno, la racha no persiste pero el cierre de caja
// (toast, confetti) tiene que seguir andando igual — por eso el try/catch acá adentro.
function actualizarRacha(feriaId, cuadro) {
  const nueva = cuadro ? getRacha(feriaId) + 1 : 0;
  try { localStorage.setItem(rachaKey(feriaId), String(nueva)); } catch { /* almacenamiento bloqueado o lleno: la racha no persiste esta vez */ }
  return nueva;
}

// Actualiza el texto de racha en el hero sin re-renderizar todo el cierre
// (así no se pierde lo que la usuaria ya tecleó en "Contado").
function actualizarRachaHero(el, racha) {
  const racEl = el.querySelector('#cierre-racha');
  if (!racEl) return;
  if (racha >= 1) {
    racEl.textContent = `🔥 ${plural(racha, 'feria seguida', 'ferias seguidas')} cuadraste`;
    racEl.hidden = false;
  } else {
    racEl.hidden = true;
  }
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

  renderCierre(feria, ventas, items, comboItems || [], anuladasHoy || 0, container.querySelector('#cierre-content'));
  renderPorFecha(feria, container, ventas, items, container.querySelector('#reporte-fechas'));
  renderTopProductos(items, comboItems || [], container.querySelector('#reporte-top-productos'));
  renderPorCategoria(items, container.querySelector('#reporte-categorias'));
}

function renderCierre(feria, ventas, items, comboItems, anuladasHoy, el) {
  const hoy = new Date().toLocaleDateString('en-CA'); // fecha LOCAL, no UTC (si no, la caja de una feria nocturna no cuadra)
  const ventasHoy = ventas.filter((v) => new Date(v.created_at).toLocaleDateString('en-CA') === hoy);
  const por = { efectivo: 0, transferencia: 0 };
  ventasHoy.forEach((v) => { por[v.metodo_pago] = (por[v.metodo_pago] || 0) + Number(v.total); });
  const racha = getRacha(feria.id);

  el.innerHTML = `
    <div class="cierre-hero">
      <p class="stat__label">💵 Esperado en efectivo</p>
      <p class="cierre-hero__monto monto">${formatMoney(por.efectivo)}</p>
      <p class="cierre-hero__racha" id="cierre-racha" ${racha >= 1 ? '' : 'hidden'}>🔥 ${plural(racha, 'feria seguida', 'ferias seguidas')} cuadraste</p>
    </div>
    ${campo({ label: 'Contado (lo que hay en la caja)', input: '<input type="number" id="cierre-contado" class="input" min="0" inputmode="numeric" placeholder="Ej: 50000" />' })}
    <div class="cierre-diferencia" id="cierre-diferencia-row">
      <span>Diferencia</span>
      <strong id="cierre-diferencia" class="monto">—</strong>
    </div>
    <div class="stats-grid">
      <div class="stat"><p class="stat__label">📲 Transferencias</p><p class="stat__valor monto">${formatMoney(por.transferencia)}</p></div>
      <div class="stat"><p class="stat__label">Ventas del día</p><p class="stat__valor">${ventasHoy.length}</p></div>
      <div class="stat"><p class="stat__label">Anuladas hoy</p><p class="stat__valor">${anuladasHoy}</p></div>
    </div>
    <button class="btn btn--primary btn--block" id="btn-cerrar-caja">Cerrar caja 🎉</button>
    <button class="btn btn--secondary btn--block" id="btn-compartir-resumen">📤 Compartir resumen del día</button>
  `;

  const contado = el.querySelector('#cierre-contado');
  const difEl = el.querySelector('#cierre-diferencia');
  const difRow = el.querySelector('#cierre-diferencia-row');
  contado.addEventListener('input', () => {
    if (contado.value === '') {
      difEl.textContent = '—';
      difEl.className = 'monto';
      difRow.className = 'cierre-diferencia';
      return;
    }
    const dif = Number(contado.value) - por.efectivo;
    difEl.textContent = `${dif === 0 ? '✓ ' : ''}${formatMoney(dif)}`;
    difEl.className = `monto ${dif === 0 ? 'cierre-ok' : 'cierre-diff'}`;
    difRow.className = `cierre-diferencia ${dif === 0 ? 'cierre-diferencia--ok' : 'cierre-diferencia--mal'}`;
  });

  el.querySelector('#btn-cerrar-caja').addEventListener('click', () => {
    const dif = contado.value === '' ? null : Number(contado.value) - por.efectivo;
    if (window.confetti) window.confetti({ particleCount: 160, spread: 90, origin: { y: 0.6 } });
    if (dif === 0) {
      // Cuadre exacto: festejo extra (ráfagas cruzadas + vibración) para que se sienta distinto de una venta cualquiera
      if (window.confetti) {
        setTimeout(() => window.confetti({ particleCount: 140, spread: 120, angle: 60, origin: { x: 0.2, y: 0.6 } }), 150);
        setTimeout(() => window.confetti({ particleCount: 140, spread: 120, angle: 120, origin: { x: 0.8, y: 0.6 } }), 300);
      }
      const nuevaRacha = actualizarRacha(feria.id, true);
      actualizarRachaHero(el, nuevaRacha);
      const rachaTxt = nuevaRacha >= 1 ? ` · 🔥 ${plural(nuevaRacha, 'feria seguida', 'ferias seguidas')} cuadraste` : '';
      import('./ui.js').then((m) => {
        m.vibrar(30);
        m.toast(`¡Cuadraste! 🎉 ${formatMoney(por.efectivo)} en efectivo${rachaTxt}`, { tipo: 'exito' });
      });
    } else if (dif == null) {
      // Sin conteo: no se sabe si cuadró o no, así que la racha queda como estaba
      import('./ui.js').then((m) => m.toast('Caja cerrada 🎉', { tipo: 'exito' }));
    } else {
      actualizarRacha(feria.id, false);
      actualizarRachaHero(el, 0);
      import('./ui.js').then((m) => m.toast(`Cerrada — diferencia de ${formatMoney(dif)} en efectivo`));
    }
  });

  el.querySelector('#btn-compartir-resumen').addEventListener('click', async () => {
    const idsHoy = new Set(ventasHoy.map((v) => v.id));
    const conteoHoy = {};
    items.filter((i) => i.tipo === 'producto' && idsHoy.has(i.venta_id)).forEach((i) => {
      conteoHoy[i.producto_nombre] = (conteoHoy[i.producto_nombre] || 0) + i.cantidad;
    });
    comboItems.filter((ci) => idsHoy.has(ci.venta_items.venta_id)).forEach((ci) => {
      conteoHoy[ci.producto_nombre] = (conteoHoy[ci.producto_nombre] || 0) + 1;
    });
    const masVendido = Object.entries(conteoHoy).sort((a, b) => b[1] - a[1])[0];
    const fechaTxt = new Date().toLocaleDateString('es-CO', { day: 'numeric', month: 'long', year: 'numeric' });
    const texto = [
      `Feria de Sofy — ${fechaTxt}`,
      `Total del día: ${formatMoney(por.efectivo + por.transferencia)}`,
      `Ventas: ${ventasHoy.length}`,
      `Producto más vendido: ${masVendido ? `${masVendido[0]} (${masVendido[1]})` : '—'}`,
    ].join('\n');

    const { toast } = await import('./ui.js');
    if (navigator.share) {
      try { await navigator.share({ text: texto }); } catch { /* la usuaria canceló el share, no es un error */ }
    } else if (navigator.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(texto);
        toast('Resumen copiado — pegalo donde quieras');
      } catch {
        toast('No se pudo copiar el resumen', { tipo: 'error' });
      }
    } else {
      toast('Este dispositivo no puede compartir ni copiar', { tipo: 'error' });
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
    const porMetodo = { efectivo: 0, transferencia: 0 };
    ventasDia.forEach((v) => { porMetodo[v.metodo_pago] = (porMetodo[v.metodo_pago] || 0) + Number(v.total); });
    const esHoy = fecha === hoy;
    const filas = ventasDia.map((v) => {
      const hora = new Date(v.created_at).toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' });
      const desc = (itemsPorVenta[v.id] || []).map((i) => i.tipo === 'producto' ? `${escapeHtml(i.producto_nombre)} x${i.cantidad}` : escapeHtml(i.producto_nombre)).join(', ') || '—';
      const metodoIcon = v.metodo_pago === 'efectivo' ? '💵' : v.metodo_pago === 'transferencia' ? '📲' : '🔵';
      const anularBtn = esHoy ? `
        <button class="btn-accion btn-accion--peligro btn-accion--sm" data-action="anular-venta" data-id="${v.id}" title="Repone stock e insumos y marca la venta como anulada">
          <svg class="icon" aria-hidden="true"><use href="#i-anular"/></svg> Anular
        </button>` : '';
      return `<div class="venta-fila"><span>${hora} ${metodoIcon}</span><span class="venta-fila__desc">${desc}</span><span class="monto">${formatMoney(v.total)}</span>${anularBtn}</div>`;
    }).join('');
    return `<details class="historial-dia" ${esHoy ? 'open' : ''}>
      <summary>
        <span class="historial-dia__titulo">${esHoy ? '⭐ Hoy' : fecha}</span>
        <span class="historial-dia__meta">${plural(ventasDia.length, 'venta', 'ventas')}</span>
        <strong class="monto historial-dia__total">${formatMoney(totalDia)}</strong>
      </summary>
      <div class="dia-metodos">💵 ${formatMoney(porMetodo.efectivo)} · 📲 ${formatMoney(porMetodo.transferencia)}</div>
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
      if (error) { toast(`No se pudo anular: ${error.message}`, { tipo: 'error' }); return; }
      toast('Venta anulada — stock repuesto', { tipo: 'exito' });
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
  const max = ranking.length ? ranking[0][1] : 1;
  el.innerHTML = ranking.map(([nombre, cant], i) => `
    <div class="rank-fila">
      <span class="rank-fila__pos">${i + 1}</span>
      <span class="rank-fila__nombre">${escapeHtml(nombre)}</span>
      <span class="barra-rank" aria-hidden="true"><span class="barra-rank__fill" style="width:${Math.max(6, Math.round((cant / max) * 100))}%"></span></span>
      <span class="rank-fila__cant monto">${cant}</span>
    </div>
  `).join('') || '<p class="list-empty">Todavía no hay ventas</p>';
}

function renderPorCategoria(items, el) {
  const porCategoria = {};
  items.forEach((i) => {
    const clave = i.tipo === 'combo' ? 'Combos' : (i.categoria_precio_nombre || 'Sin categoría');
    porCategoria[clave] = (porCategoria[clave] || 0) + i.precio_unitario * i.cantidad;
  });
  // Mismo tratamiento visual que renderTopProductos (barra proporcional al máximo)
  // para que las dos listas de ranking se lean como un solo sistema, no dos estilos distintos.
  const entradas = Object.entries(porCategoria).sort((a, b) => b[1] - a[1]);
  const max = entradas.length ? entradas[0][1] : 1;
  el.innerHTML = entradas.map(([nombre, total]) => `
    <div class="categoria-fila">
      <span class="categoria-fila__nombre">${escapeHtml(nombre)}</span>
      <span class="barra-rank" aria-hidden="true"><span class="barra-rank__fill" style="width:${Math.max(6, Math.round((total / max) * 100))}%"></span></span>
      <span class="categoria-fila__monto monto">${formatMoney(total)}</span>
    </div>
  `).join('') || '<p class="list-empty">Todavía no hay ventas</p>';
}
