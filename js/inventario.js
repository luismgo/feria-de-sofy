import { supabase } from './supabaseClient.js';
import { confirmDialog, toast } from './ui.js';

export function initInventario(feria) {
  const container = document.getElementById('tab-inventario');
  container.innerHTML = '<p>Cargando inventario...</p>';
  render(feria, container);
  return () => {};
}

async function render(feria, container) {
  const [{ data: categorias }, { data: combos }] = await Promise.all([
    supabase.from('categorias_precio').select('*').eq('feria_id', feria.id).order('orden'),
    supabase.from('combos').select('*').eq('feria_id', feria.id).order('nombre'),
  ]);

  container.innerHTML = `
    <section class="inv-section">
      <h2>Categorías de precio</h2>
      <div id="inv-categorias" class="inv-list"></div>
      <form id="form-categoria" class="inv-form">
        <input name="nombre" placeholder="Nombre (ej: Chico)" required />
        <input name="precio" type="number" step="1" min="0" placeholder="Precio" required />
        <button type="submit">Agregar categoría</button>
      </form>
    </section>

    <section class="inv-section">
      <h2>Combos</h2>
      <div id="inv-combos" class="inv-list"></div>
      <form id="form-combo" class="inv-form">
        <input name="nombre" placeholder="Nombre (ej: Combo 3 stickers)" required />
        <input name="cantidad" type="number" min="1" placeholder="Cantidad de productos" required />
        <input name="precio" type="number" step="1" min="0" placeholder="Precio del combo" required />
        <button type="submit">Agregar combo</button>
      </form>
    </section>

    <section class="inv-section" id="inv-productos-section">
      <p>La sección de Productos se agrega en la Tarea 9.</p>
    </section>
  `;

  renderCategorias(feria, categorias, container);
  renderCombos(feria, combos, container);

  container.querySelector('#form-categoria').addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.target;
    await supabase.from('categorias_precio').insert({
      feria_id: feria.id,
      nombre: form.nombre.value.trim(),
      precio: Number(form.precio.value),
      orden: categorias.length,
    });
    render(feria, container);
  });

  container.querySelector('#form-combo').addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.target;
    await supabase.from('combos').insert({
      feria_id: feria.id,
      nombre: form.nombre.value.trim(),
      cantidad: Number(form.cantidad.value),
      precio: Number(form.precio.value),
    });
    render(feria, container);
  });
}

function renderCategorias(feria, categorias, container) {
  const list = container.querySelector('#inv-categorias');
  list.innerHTML = categorias.map((c) => `
    <div class="inv-row" data-id="${c.id}">
      <span>${c.nombre} — $${c.precio}</span>
      <button class="btn-icon" data-action="eliminar-categoria" data-id="${c.id}">🗑️</button>
    </div>
  `).join('') || '<p class="inv-empty">Todavía no hay categorías de precio</p>';

  list.querySelectorAll('[data-action="eliminar-categoria"]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const ok = await confirmDialog('¿Eliminar esta categoría de precio? Los productos que la usan quedarán sin categoría.');
      if (!ok) return;
      await supabase.from('categorias_precio').delete().eq('id', btn.dataset.id);
      render(feria, container);
    });
  });
}

function renderCombos(feria, combos, container) {
  const list = container.querySelector('#inv-combos');
  list.innerHTML = combos.map((c) => `
    <div class="inv-row" data-id="${c.id}">
      <span>${c.nombre} — ${c.cantidad} productos por $${c.precio} ${c.activo ? '' : '(inactivo)'}</span>
      <button class="btn-icon" data-action="toggle-combo" data-id="${c.id}" data-activo="${c.activo}">${c.activo ? '⏸️' : '▶️'}</button>
      <button class="btn-icon" data-action="eliminar-combo" data-id="${c.id}">🗑️</button>
    </div>
  `).join('') || '<p class="inv-empty">Todavía no hay combos</p>';

  list.querySelectorAll('[data-action="toggle-combo"]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      await supabase.from('combos').update({ activo: btn.dataset.activo !== 'true' }).eq('id', btn.dataset.id);
      render(feria, container);
    });
  });

  list.querySelectorAll('[data-action="eliminar-combo"]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const ok = await confirmDialog('¿Eliminar este combo?');
      if (!ok) return;
      await supabase.from('combos').delete().eq('id', btn.dataset.id);
      render(feria, container);
    });
  });
}
