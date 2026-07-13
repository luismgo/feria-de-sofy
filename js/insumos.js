import { supabase } from './supabaseClient.js';
import { confirmDialog, mutar, toast, escapeHtml, abrirModal, campo } from './ui.js';

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
    <button type="button" class="btn-accion" data-toggle="form-insumo">
      <svg class="icon" aria-hidden="true"><use href="#i-mas"/></svg> Agregar insumo
    </button>
    <form id="form-insumo" class="form-alta hidden">
      ${campo({ label: 'Nombre', input: '<input name="nombre" class="input" placeholder="Ej: Bolsita transparente" required />' })}
      ${campo({ label: 'Stock inicial', input: '<input name="stock" class="input" type="number" min="0" inputmode="numeric" placeholder="Ej: 100" required />' })}
      ${campo({ label: 'Costo por unidad en pesos', hint: 'Cuánto te cuesta a vos cada uno (para saber tu ganancia más adelante).', input: '<input name="costo" class="input" type="number" min="0" step="1" inputmode="numeric" value="0" />' })}
      <button type="submit" class="btn btn--primary">Guardar insumo</button>
    </form>
  `;

  const list = container.querySelector('#inv-insumos');
  list.innerHTML = insumos.map((i) => `
    <div class="row" data-id="${i.id}">
      <span class="row__nombre">${escapeHtml(i.nombre)}</span>
      <label class="inv-mini-label">Stock <input type="number" class="insumo-stock-input" data-id="${i.id}" value="${i.stock}" min="0" /></label>
      <label class="inv-mini-label">Costo $<input type="number" class="insumo-costo-input" data-id="${i.id}" value="${i.costo ?? 0}" min="0" step="1" /></label>
      <button class="btn-accion btn-accion--peligro btn-accion--sm" data-action="eliminar-insumo" data-id="${i.id}" title="Eliminar este insumo">
        <svg class="icon" aria-hidden="true"><use href="#i-trash"/></svg> Eliminar
      </button>
    </div>
  `).join('') || '<p class="list-empty">Todavía no hay insumos</p>';

  const toggleBtn = container.querySelector('[data-toggle="form-insumo"]');
  const form = container.querySelector('#form-insumo');
  toggleBtn.addEventListener('click', () => {
    form.classList.toggle('hidden');
    if (!form.classList.contains('hidden')) form.querySelector('input').focus();
  });

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
    const f = e.target;
    const submitBtn = f.querySelector('button[type="submit"]');
    submitBtn.disabled = true;
    const { error } = await mutar(supabase.from('insumos').insert({ nombre: f.nombre.value.trim(), stock: Number(f.stock.value), costo: Number(f.costo.value || 0) }), 'No se pudo crear el insumo');
    if (error) { submitBtn.disabled = false; return; }
    renderInsumosSection(container);
  });
}

// Insumos de un producto: qué insumos descuenta del stock al venderse (uno o varios).
// No todo producto es una "receta" — es simplemente la lista de insumos que gasta.
export async function abrirInsumosProducto(producto) {
  const insumos = await fetchInsumos();
  const { data: asignados } = await supabase.from('producto_insumos').select('*').eq('producto_id', producto.id);

  const { dialogo, cerrar } = abrirModal({
    titulo: `Insumos de "${producto.nombre}"`,
    contenidoHTML: '<div id="insumos-modal-body"></div>',
  });
  const body = dialogo.querySelector('#insumos-modal-body');

  function render() {
    body.innerHTML = `
      <p class="card__hint">Qué se descuenta del stock al vender una unidad.</p>
      <div id="insumos-list" class="inv-list">
        ${asignados.map((r) => {
          const insumo = insumos.find((i) => i.id === r.insumo_id);
          return `
            <div class="row">
              <span>${insumo ? escapeHtml(insumo.nombre) : '(insumo eliminado)'} x ${r.cantidad}</span>
              <button class="btn-accion btn-accion--peligro btn-accion--sm" data-action="quitar-insumo" data-id="${r.id}" title="Quitar este insumo del producto">
                <svg class="icon" aria-hidden="true"><use href="#i-quitar"/></svg> Quitar
              </button>
            </div>
          `;
        }).join('') || '<p class="list-empty">Sin insumos asignados todavía</p>'}
      </div>
      <form id="form-agregar-insumo" class="form-alta">
        ${campo({ label: 'Insumo', input: `<select name="insumo_id" class="input">${insumos.map((i) => `<option value="${i.id}">${escapeHtml(i.nombre)}</option>`).join('')}</select>` })}
        ${campo({ label: 'Cantidad por unidad vendida', input: '<input name="cantidad" class="input" type="number" min="1" value="1" inputmode="numeric" required />' })}
        <button type="submit" class="btn btn--primary">Agregar insumo</button>
      </form>
      <div class="modal-actions">
        <button type="button" class="btn btn--secondary" data-action="cerrar">Cerrar</button>
      </div>
    `;
  }

  render();

  // Delegación en el diálogo (no en los elementos internos): el modal
  // reconstruye su innerHTML en cada render(), así que un listener puesto
  // directamente en el <form> quedaría huérfano después del primer cambio.
  dialogo.addEventListener('click', async (e) => {
    const action = e.target.closest('[data-action]')?.dataset.action;
    if (action === 'cerrar') { cerrar(null); return; }
    if (action === 'quitar-insumo') {
      const id = e.target.closest('[data-action]').dataset.id;
      const { error } = await mutar(supabase.from('producto_insumos').delete().eq('id', id), 'No se pudo quitar el insumo');
      if (error) return;
      const idx = asignados.findIndex((r) => r.id === id);
      if (idx >= 0) asignados.splice(idx, 1);
      render();
    }
  });

  dialogo.addEventListener('submit', async (e) => {
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
    if (error || !nueva) { submitBtn.disabled = false; toast('No se pudo agregar el insumo', { tipo: 'error' }); return; }
    const idx = asignados.findIndex((r) => r.insumo_id === form.insumo_id.value);
    if (idx >= 0) asignados[idx] = nueva; else asignados.push(nueva);
    render();
  });
}
