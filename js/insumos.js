import { supabase } from './supabaseClient.js';
import { confirmDialog, mutar, toast, escapeHtml } from './ui.js';

export async function fetchInsumos() {
  const { data } = await supabase.from('insumos').select('*').order('nombre');
  return data || [];
}

export async function renderInsumosSection(container) {
  const insumos = await fetchInsumos();

  container.innerHTML = `
    <h2>Insumos</h2>
    <p class="card__hint">Empaques y materiales que se descuentan solos al vender, sin venderse ellos mismos (ej. bolsitas).</p>
    <div id="inv-insumos" class="inv-list"></div>
    <form id="form-insumo" class="inv-form">
      <input name="nombre" placeholder="Nombre (ej: Bolsita transparente)" required />
      <input name="stock" type="number" min="0" placeholder="Stock inicial" required />
      <input name="costo" type="number" min="0" step="1" placeholder="Costo $" value="0" />
      <button type="submit">Agregar insumo</button>
    </form>
  `;

  const list = container.querySelector('#inv-insumos');
  list.innerHTML = insumos.map((i) => `
    <div class="row" data-id="${i.id}">
      <span>${escapeHtml(i.nombre)}</span>
      <label class="inv-mini-label">Stock <input type="number" class="insumo-stock-input" data-id="${i.id}" value="${i.stock}" min="0" /></label>
      <label class="inv-mini-label">Costo $<input type="number" class="insumo-costo-input" data-id="${i.id}" value="${i.costo ?? 0}" min="0" step="1" /></label>
      <button class="btn-accion btn-accion--peligro" data-action="eliminar-insumo" data-id="${i.id}" title="Eliminar este insumo">🗑️ Eliminar</button>
    </div>
  `).join('') || '<p class="list-empty">Todavía no hay insumos</p>';

  list.querySelectorAll('.insumo-stock-input').forEach((input) => {
    input.addEventListener('change', async () => {
      const val = Number(input.value);
      if (input.value === '' || !Number.isFinite(val) || val < 0) {
        toast('Poné un stock válido (0 o más).');
        input.value = input.defaultValue;
        return;
      }
      const { error } = await mutar(supabase.from('insumos').update({ stock: val }).eq('id', input.dataset.id), 'No se pudo actualizar el stock del insumo');
      if (!error) input.defaultValue = String(val);
    });
  });

  list.querySelectorAll('.insumo-costo-input').forEach((input) => {
    input.addEventListener('change', async () => {
      const val = Number(input.value);
      if (input.value === '' || !Number.isFinite(val) || val < 0) {
        toast('Poné un costo válido (0 o más).');
        input.value = input.defaultValue;
        return;
      }
      const { error } = await mutar(supabase.from('insumos').update({ costo: val }).eq('id', input.dataset.id), 'No se pudo actualizar el costo del insumo');
      if (!error) input.defaultValue = String(val);
    });
  });

  list.querySelectorAll('[data-action="eliminar-insumo"]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const ok = await confirmDialog('¿Eliminar este insumo? Se quita también de los productos que lo usaban.', { peligro: true });
      if (!ok) return;
      const { error } = await mutar(supabase.from('insumos').delete().eq('id', btn.dataset.id), 'No se pudo eliminar el insumo');
      if (error) return;
      renderInsumosSection(container);
    });
  });

  container.querySelector('#form-insumo').addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.target;
    const submitBtn = form.querySelector('button[type="submit"]');
    submitBtn.disabled = true;
    const { error } = await mutar(supabase.from('insumos').insert({ nombre: form.nombre.value.trim(), stock: Number(form.stock.value), costo: Number(form.costo.value || 0) }), 'No se pudo crear el insumo');
    if (error) { submitBtn.disabled = false; return; }
    renderInsumosSection(container);
  });
}

// Insumos de un producto: qué insumos descuenta del stock al venderse (uno o varios).
// No todo producto es una "receta" — es simplemente la lista de insumos que gasta.
export async function abrirInsumosProducto(producto) {
  const insumos = await fetchInsumos();
  const { data: asignados } = await supabase.from('producto_insumos').select('*').eq('producto_id', producto.id);

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';

  function render() {
    overlay.innerHTML = `
      <div class="modal">
        <p>Insumos de "${escapeHtml(producto.nombre)}" — qué se descuenta del stock al vender una unidad</p>
        <div id="insumos-list" class="inv-list">
          ${asignados.map((r) => {
            const insumo = insumos.find((i) => i.id === r.insumo_id);
            return `
              <div class="row">
                <span>${insumo ? escapeHtml(insumo.nombre) : '(insumo eliminado)'} x ${r.cantidad}</span>
                <button class="btn-accion btn-accion--peligro btn-accion--sm" data-action="quitar-insumo" data-id="${r.id}" title="Quitar este insumo del producto">🗑️ Quitar</button>
              </div>
            `;
          }).join('') || '<p class="list-empty">Sin insumos asignados todavía</p>'}
        </div>
        <form id="form-agregar-insumo" class="inv-form">
          <select name="insumo_id">
            ${insumos.map((i) => `<option value="${i.id}">${escapeHtml(i.nombre)}</option>`).join('')}
          </select>
          <input name="cantidad" type="number" min="1" value="1" placeholder="Cantidad" required />
          <button type="submit">Agregar insumo</button>
        </form>
        <div class="modal-actions">
          <button class="btn btn--secondary" data-action="cerrar">Cerrar</button>
        </div>
      </div>
    `;
  }

  render();
  document.body.appendChild(overlay);

  // Delegación en `overlay` (no en los elementos internos): el modal
  // reconstruye su innerHTML en cada render(), así que un listener puesto
  // directamente en el <form> quedaría huérfano después del primer cambio.
  overlay.addEventListener('click', async (e) => {
    if (e.target.dataset.action === 'cerrar') {
      document.body.removeChild(overlay);
      return;
    }
    if (e.target.dataset.action === 'quitar-insumo') {
      const { error } = await mutar(supabase.from('producto_insumos').delete().eq('id', e.target.dataset.id), 'No se pudo quitar el insumo');
      if (error) return;
      const idx = asignados.findIndex((r) => r.id === e.target.dataset.id);
      if (idx >= 0) asignados.splice(idx, 1);
      render();
    }
  });

  overlay.addEventListener('submit', async (e) => {
    if (e.target.id !== 'form-agregar-insumo') return;
    e.preventDefault();
    const form = e.target;
    const submitBtn = form.querySelector('button[type="submit"]');
    submitBtn.disabled = true;
    const { data: nueva, error } = await supabase.from('producto_insumos').upsert({
      producto_id: producto.id,
      insumo_id: form.insumo_id.value,
      cantidad: Number(form.cantidad.value),
    }, { onConflict: 'producto_id,insumo_id' }).select().single();
    // Si el upsert falla, `nueva` es null: NO lo metemos al array o el próximo render() crashea con r.insumo_id sobre null.
    if (error || !nueva) { submitBtn.disabled = false; toast('No se pudo agregar el insumo'); return; }
    const idx = asignados.findIndex((r) => r.insumo_id === form.insumo_id.value);
    if (idx >= 0) asignados[idx] = nueva; else asignados.push(nueva);
    render();
  });
}
