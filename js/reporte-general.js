import { supabase } from './supabaseClient.js';

export async function initReporteGeneral({ onVolver }) {
  const screen = document.getElementById('reporte-general');
  const content = document.getElementById('reporte-general-content');
  screen.classList.remove('hidden');
  content.innerHTML = '<p>Cargando...</p>';

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
    <section class="inv-section">
      <h2>Total combinado</h2>
      <p class="carrito-total">$${totalGeneral} — ${cantidadGeneral} ventas</p>
    </section>
    <section class="inv-section">
      <h2>Por feria</h2>
      ${Object.values(porFeria).map((r) => `
        <div class="inv-row">
          <span>${r.feria.emoji} ${r.feria.nombre}</span>
          <span>$${r.total} (${r.cantidad} ventas)</span>
        </div>
      `).join('') || '<p class="inv-empty">Todavía no hay ferias</p>'}
    </section>
  `;
}
