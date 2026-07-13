import { supabase } from './supabaseClient.js';
import { escapeHtml, formatMoney, cargando } from './ui.js';

export async function initReporteGeneral({ onVolver }) {
  const screen = document.getElementById('reporte-general');
  const content = document.getElementById('reporte-general-content');
  screen.classList.remove('hidden');
  content.innerHTML = cargando('Cargando el reporte...');

  document.getElementById('btn-volver-selector').onclick = () => {
    screen.classList.add('hidden');
    onVolver();
  };

  const { data: ferias, error: feriasError } = await supabase.from('ferias').select('*').order('nombre');
  const { data: ventas, error: ventasError } = await supabase.from('ventas').select('feria_id, total').eq('anulada', false);
  if (feriasError || ventasError) {
    content.innerHTML = '<p class="error">No se pudo cargar el reporte general — revisá la conexión</p>';
    return;
  }

  const porFeria = {};
  (ferias || []).forEach((f) => { porFeria[f.id] = { feria: f, total: 0, cantidad: 0 }; });
  (ventas || []).forEach((v) => {
    if (!porFeria[v.feria_id]) return;
    porFeria[v.feria_id].total += Number(v.total);
    porFeria[v.feria_id].cantidad += 1;
  });

  const totalGeneral = Object.values(porFeria).reduce((sum, r) => sum + r.total, 0);
  const cantidadGeneral = Object.values(porFeria).reduce((sum, r) => sum + r.cantidad, 0);

  content.innerHTML = `
    <section class="card cierre-hero">
      <p class="stat__label">Total combinado de todas las ferias</p>
      <p class="cierre-hero__monto monto">${formatMoney(totalGeneral)}</p>
      <p class="card__hint">${cantidadGeneral} ${cantidadGeneral === 1 ? 'venta' : 'ventas'} en total</p>
    </section>
    <section class="card">
      <h2>Por feria</h2>
      ${Object.values(porFeria).map((r) => `
        <div class="row">
          <span class="emoji-circulo" aria-hidden="true">${escapeHtml(r.feria.emoji)}</span>
          <span class="row__main">${escapeHtml(r.feria.nombre)} <span class="row__meta">${r.cantidad} ${r.cantidad === 1 ? 'venta' : 'ventas'}</span></span>
          <span class="monto row__monto">${formatMoney(r.total)}</span>
        </div>
      `).join('') || '<p class="list-empty">Todavía no hay ferias</p>'}
    </section>
  `;
}
