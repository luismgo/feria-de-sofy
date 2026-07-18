import { supabase } from './supabaseClient.js';
import { confirmDialog, toast, mutar, escapeHtml, formatMoney, uuid, promptDialog, abrirModal, campo, cargando, comprimirImagen } from './ui.js';
import { renderInsumosSection, abrirInsumosProducto } from './insumos.js';

let vista = 'menu'; // 'menu' | 'categorias' | 'combos' | 'productos' | 'insumos' — se resetea al entrar a la pestaña

export function initInventario(feria) {
  vista = 'menu';
  const container = document.getElementById('tab-inventario');
  container.innerHTML = cargando('Cargando inventario...', { kind: 'lista' });
  render(feria, container);
  return () => {};
}

// Cablea el botón "Agregar..." que muestra/oculta el formulario de alta de una sección.
function bindToggleForm(container, toggleSel, formSel) {
  const btn = container.querySelector(toggleSel);
  const form = container.querySelector(formSel);
  btn.addEventListener('click', () => {
    form.classList.toggle('hidden');
    if (!form.classList.contains('hidden')) form.querySelector('input, select')?.focus();
  });
}

// Cablea el FAB que despliega y lleva (scroll + foco) hasta un formulario de alta.
// Con muchos productos, el botón "Agregar" al final de la lista queda a varios scrolls
// de distancia; el FAB lo resuelve sin importar dónde esté parada la usuaria.
function bindFab(container, fabSel, formSel) {
  const fab = container.querySelector(fabSel);
  const form = container.querySelector(formSel);
  fab.addEventListener('click', () => {
    form.classList.remove('hidden');
    const behavior = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth';
    form.scrollIntoView({ behavior, block: 'center' });
    form.querySelector('input, select')?.focus({ preventScroll: true });
  });
}

async function render(feria, container) {
  if (vista === 'menu') return renderMenu(feria, container);
  return renderSubvista(feria, container);
}

// Pantalla principal: 4 filas con conteo liviano (count-only, sin traer el detalle
// completo solo para mostrar un número) a cada submenú.
async function renderMenu(feria, container) {
  const [{ count: nCategorias }, { count: nCombos }, { count: nProductos }, { count: nInsumos }] = await Promise.all([
    supabase.from('categorias_precio').select('*', { count: 'exact', head: true }).eq('feria_id', feria.id),
    supabase.from('combos').select('*', { count: 'exact', head: true }).eq('feria_id', feria.id),
    supabase.from('feria_productos').select('*', { count: 'exact', head: true }).eq('feria_id', feria.id),
    supabase.from('insumos').select('*', { count: 'exact', head: true }),
  ]);

  const fila = (vistaId, emoji, titulo, n, singular, plural) => `
    <button type="button" class="inv-menu__item" data-vista="${vistaId}">
      <span class="inv-menu__icon" aria-hidden="true">${emoji}</span>
      <span class="inv-menu__texto">
        <span class="inv-menu__titulo">${titulo}</span>
        <span class="inv-menu__conteo">${n === 1 ? `1 ${singular}` : `${n ?? 0} ${plural}`}</span>
      </span>
      <svg class="icon inv-menu__chevron" aria-hidden="true"><use href="#i-chevron"/></svg>
    </button>
  `;

  container.innerHTML = `
    <div class="inv-menu">
      ${fila('categorias', '🏷️', 'Categorías de precio', nCategorias, 'categoría', 'categorías')}
      ${fila('combos', '🎁', 'Combos', nCombos, 'combo', 'combos')}
      ${fila('productos', '📦', 'Productos', nProductos, 'producto', 'productos')}
      ${fila('insumos', '🧵', 'Insumos', nInsumos, 'insumo', 'insumos')}
    </div>
  `;

  container.querySelectorAll('.inv-menu__item').forEach((btn) => {
    btn.addEventListener('click', () => {
      vista = btn.dataset.vista;
      render(feria, container);
    });
  });
}

// Pantalla de detalle: header local "‹ Inventario" (sticky, no toca el navbar global)
// + el contenido de la sección elegida, tal cual existía antes de este cambio.
async function renderSubvista(feria, container) {
  container.innerHTML = `
    <div class="inv-subview__header">
      <button type="button" class="inv-subview__back" data-action="volver-menu">
        <svg class="icon" aria-hidden="true"><use href="#i-atras"/></svg> Inventario
      </button>
    </div>
    <div class="inv-subview__body"></div>
  `;
  container.querySelector('[data-action="volver-menu"]').addEventListener('click', () => {
    vista = 'menu';
    render(feria, container);
  });

  if (vista === 'categorias') return renderCategoriasVista(feria, container);
  if (vista === 'combos') return renderCombosVista(feria, container);
  if (vista === 'productos') return renderProductosVista(feria, container);
  if (vista === 'insumos') return renderInsumosSection(container.querySelector('.inv-subview__body'));
}

async function renderCategoriasVista(feria, container) {
  const body = container.querySelector('.inv-subview__body');
  body.innerHTML = cargando('Cargando categorías...', { kind: 'lista' });
  const { data: categorias, error } = await supabase.from('categorias_precio').select('*').eq('feria_id', feria.id).order('orden');
  if (error) {
    body.innerHTML = '<p class="error">No se pudo cargar — revisá la conexión</p>';
    return;
  }
  body.innerHTML = `
    <section class="card">
      <h2>Categorías de precio</h2>
      <p class="card__hint">Agrupá productos por precio: todos los de una categoría valen lo mismo (ej: "Chico" = $100). Así cambiás un precio en un solo lugar.</p>
      <div id="inv-categorias" class="inv-list"></div>
      <button type="button" class="btn-accion" data-toggle-categoria>
        <svg class="icon" aria-hidden="true"><use href="#i-mas"/></svg> Agregar categoría
      </button>
      <form id="form-categoria" class="form-alta hidden">
        ${campo({ label: 'Nombre', input: '<input name="nombre" class="input" placeholder="Ej: Chico" required />' })}
        ${campo({ label: 'Precio en pesos', input: '<input name="precio" class="input" type="number" step="1" min="0" inputmode="numeric" placeholder="Ej: 5000" required />' })}
        <button type="submit" class="btn btn--primary">Guardar categoría</button>
      </form>
    </section>
  `;

  bindToggleForm(container, '[data-toggle-categoria]', '#form-categoria');
  renderCategorias(feria, categorias, container);

  container.querySelector('#form-categoria').addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.target;
    const submitBtn = form.querySelector('button[type="submit"]');
    submitBtn.disabled = true;
    const { error: insertError } = await mutar(supabase.from('categorias_precio').insert({
      feria_id: feria.id,
      nombre: form.nombre.value.trim(),
      precio: Number(form.precio.value),
      orden: categorias.length,
    }), 'No se pudo crear la categoría');
    if (insertError) { submitBtn.disabled = false; return; }
    render(feria, container);
  });
}

async function renderCombosVista(feria, container) {
  const body = container.querySelector('.inv-subview__body');
  body.innerHTML = cargando('Cargando combos...', { kind: 'lista' });
  const { data: combos, error } = await supabase.from('combos').select('*').eq('feria_id', feria.id).order('nombre');
  if (error) {
    body.innerHTML = '<p class="error">No se pudo cargar — revisá la conexión</p>';
    return;
  }
  body.innerHTML = `
    <section class="card">
      <h2>Combos</h2>
      <p class="card__hint">Un combo vende varios productos juntos a un precio especial (ej: "3 stickers por $250"). Al vender elegís qué productos entran.</p>
      <div id="inv-combos" class="inv-list"></div>
      <button type="button" class="btn-accion" data-toggle-combo>
        <svg class="icon" aria-hidden="true"><use href="#i-mas"/></svg> Agregar combo
      </button>
      <form id="form-combo" class="form-alta hidden">
        ${campo({ label: 'Nombre', input: '<input name="nombre" class="input" placeholder="Ej: Combo 3 stickers" required />' })}
        ${campo({ label: 'Cantidad de productos que incluye', input: '<input name="cantidad" class="input" type="number" min="1" inputmode="numeric" placeholder="Ej: 3" required />' })}
        ${campo({ label: 'Precio del combo en pesos', input: '<input name="precio" class="input" type="number" step="1" min="0" inputmode="numeric" placeholder="Ej: 12000" required />' })}
        <button type="submit" class="btn btn--primary">Guardar combo</button>
      </form>
    </section>
  `;

  bindToggleForm(container, '[data-toggle-combo]', '#form-combo');
  renderCombos(feria, combos, container);

  container.querySelector('#form-combo').addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.target;
    const submitBtn = form.querySelector('button[type="submit"]');
    submitBtn.disabled = true;
    const { error: insertError } = await mutar(supabase.from('combos').insert({
      feria_id: feria.id,
      nombre: form.nombre.value.trim(),
      cantidad: Number(form.cantidad.value),
      precio: Number(form.precio.value),
    }), 'No se pudo crear el combo');
    if (insertError) { submitBtn.disabled = false; return; }
    render(feria, container);
  });
}

async function renderProductosVista(feria, container) {
  const body = container.querySelector('.inv-subview__body');
  body.innerHTML = cargando('Cargando productos...', { kind: 'lista' });

  const { data: categorias, error: catError } = await supabase.from('categorias_precio').select('*').eq('feria_id', feria.id).order('orden');
  if (catError) {
    body.innerHTML = '<p class="error">No se pudo cargar — revisá la conexión</p>';
    return;
  }

  body.innerHTML = `
    <section class="card" id="inv-productos-section">
      <h2>Productos</h2>
      <p class="card__hint">Lo que vendés. El stock es compartido entre todas tus ferias; el precio se define por feria.</p>
      <div id="inv-productos" class="inv-list"></div>
      <div class="inv-productos-acciones">
        <button type="button" class="btn-accion" data-toggle-producto>
          <svg class="icon" aria-hidden="true"><use href="#i-mas"/></svg> Agregar producto
        </button>
        <button id="btn-reutilizar" class="btn-accion" type="button" title="Traer a esta feria un producto que ya existe en otra">
          <svg class="icon" aria-hidden="true"><use href="#i-anular"/></svg> Traer de otra feria
        </button>
      </div>
      <form id="form-producto" class="form-alta hidden">
        ${campo({ label: 'Nombre del producto', input: '<input name="nombre" class="input" placeholder="Ej: Sticker mariposa" required />' })}
        ${campo({ label: 'Descripción (opcional)', hint: 'Ej: medidas. Útil para distinguir productos con el mismo nombre.', input: '<input name="descripcion" class="input" placeholder="Ej: 5x3cm" />' })}
        ${campo({ label: 'Categoría de precio', hint: 'La mayoría de los productos van en una categoría de precio. Elegí "Sin categoría" solo si este necesita un precio propio (se pone después, acá mismo).', input: `
          <select name="categoria_precio_id" class="input">
            ${categorias.map((c) => `<option value="${c.id}">${escapeHtml(c.nombre)} (${formatMoney(c.precio)})</option>`).join('')}
            <option value="">Sin categoría — precio individual</option>
          </select>` })}
        ${campo({ label: 'Stock inicial', input: '<input name="stock" class="input" type="number" min="0" inputmode="numeric" placeholder="Ej: 20" required />' })}
        ${campo({ label: 'Foto (opcional)', input: '<input name="foto" class="input input--file" type="file" accept="image/*" />' })}
        <button type="submit" class="btn btn--primary">Guardar producto</button>
      </form>
    </section>
    <button type="button" class="inv-fab" id="inv-fab-producto" aria-label="Ir a agregar producto" title="Ir a agregar producto">
      <svg class="icon" aria-hidden="true"><use href="#i-mas"/></svg>
    </button>
  `;

  bindToggleForm(container, '[data-toggle-producto]', '#form-producto');
  bindFab(container, '#inv-fab-producto', '#form-producto');

  const { data: productos } = await supabase
    .from('feria_productos')
    .select('id, categoria_precio_id, precio_override, productos(id, nombre, descripcion, imagen_url, stock, costo)')
    .eq('feria_id', feria.id);

  renderProductos(feria, productos || [], categorias, container);

  container.querySelector('#form-producto').addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.target;
    const submitBtn = form.querySelector('button[type="submit"]');
    submitBtn.disabled = true;
    submitBtn.textContent = 'Guardando...';

    let imagen_url = null;
    const file = form.foto.files[0];
    if (file) {
      const comprimida = await comprimirImagen(file);
      const path = `${uuid()}.jpg`;
      const { error: uploadError } = await supabase.storage.from('productos-fotos').upload(path, comprimida, { contentType: 'image/jpeg' });
      if (!uploadError) {
        imagen_url = supabase.storage.from('productos-fotos').getPublicUrl(path).data.publicUrl;
      } else {
        toast('No se pudo subir la foto, se guarda el producto sin foto');
      }
    }

    const { data: producto, error: prodError } = await supabase
      .from('productos')
      .insert({ nombre: form.nombre.value.trim(), descripcion: form.descripcion.value.trim() || null, stock: Number(form.stock.value), imagen_url })
      .select()
      .single();

    if (prodError) {
      toast('No se pudo crear el producto', { tipo: 'error' });
      submitBtn.disabled = false;
      submitBtn.textContent = 'Guardar producto';
      return;
    }

    const { error: fpError } = await supabase.from('feria_productos').insert({
      feria_id: feria.id,
      producto_id: producto.id,
      categoria_precio_id: form.categoria_precio_id.value || null,
    });

    if (fpError) {
      toast('No se pudo vincular el producto a esta feria', { tipo: 'error' });
      submitBtn.disabled = false;
      submitBtn.textContent = 'Guardar producto';
      return;
    }

    render(feria, container);
  });

  container.querySelector('#btn-reutilizar').addEventListener('click', () => abrirReutilizarModal(feria, categorias, container));
}

function renderCategorias(feria, categorias, container) {
  const list = container.querySelector('#inv-categorias');
  list.innerHTML = categorias.map((c) => `
    <div class="row" data-id="${c.id}">
      <span>${escapeHtml(c.nombre)} — <span class="monto">${formatMoney(c.precio)}</span></span>
      <button class="btn-accion btn-accion--peligro" data-action="eliminar-categoria" data-id="${c.id}" title="Eliminar esta categoría de precio">
        <svg class="icon" aria-hidden="true"><use href="#i-trash"/></svg> Eliminar
      </button>
    </div>
  `).join('') || '<p class="list-empty">Todavía no hay categorías de precio</p>';

  list.querySelectorAll('[data-action="eliminar-categoria"]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const ok = await confirmDialog('¿Eliminar esta categoría de precio? Los productos que la usan quedarán sin categoría.', { peligro: true });
      if (!ok) return;
      await supabase.from('categorias_precio').delete().eq('id', btn.dataset.id);
      render(feria, container);
    });
  });
}

function renderCombos(feria, combos, container) {
  const list = container.querySelector('#inv-combos');
  list.innerHTML = combos.map((c) => `
    <div class="row" data-id="${c.id}">
      <span>${escapeHtml(c.nombre)} — ${c.cantidad} productos por <span class="monto">${formatMoney(c.precio)}</span>${c.activo ? '' : ' (en pausa)'}</span>
      <div class="row__actions">
        <button class="btn-accion" data-action="toggle-combo" data-id="${c.id}" data-activo="${c.activo}" title="${c.activo ? 'Deja de aparecer al vender' : 'Vuelve a aparecer al vender'}">
          <svg class="icon" aria-hidden="true"><use href="#i-${c.activo ? 'pausa' : 'play'}"/></svg> ${c.activo ? 'Pausar' : 'Activar'}
        </button>
        <button class="btn-accion btn-accion--peligro" data-action="eliminar-combo" data-id="${c.id}" title="Eliminar este combo">
          <svg class="icon" aria-hidden="true"><use href="#i-trash"/></svg> Eliminar
        </button>
      </div>
    </div>
  `).join('') || '<p class="list-empty">Todavía no hay combos</p>';

  list.querySelectorAll('[data-action="toggle-combo"]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      await supabase.from('combos').update({ activo: btn.dataset.activo !== 'true' }).eq('id', btn.dataset.id);
      render(feria, container);
    });
  });

  list.querySelectorAll('[data-action="eliminar-combo"]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const ok = await confirmDialog('¿Eliminar este combo?', { peligro: true });
      if (!ok) return;
      await supabase.from('combos').delete().eq('id', btn.dataset.id);
      render(feria, container);
    });
  });
}

// Fila de un producto (sin cambios de comportamiento — solo se movió a función aparte
// para poder agruparla por categoría en renderProductos).
function filaProducto(fp, categorias) {
  const p = fp.productos;
  const categoria = categorias.find((c) => c.id === fp.categoria_precio_id);
  const precio = fp.precio_override != null ? fp.precio_override : (categoria ? categoria.precio : null);
  const precioBadge = precio != null
    ? `<span class="inv-producto__precio">${formatMoney(precio)}</span>`
    : `<span class="inv-producto__precio inv-producto__precio--sin">Sin precio</span>`;
  return `
    <div class="inv-producto" data-id="${fp.id}" data-override="${fp.precio_override ?? ''}">
      <div class="inv-producto__head">
        ${p.imagen_url ? `<img class="row__foto" src="${p.imagen_url}" alt="${escapeHtml(p.nombre)}" />` : '<span class="row__foto row__foto--sin" aria-hidden="true">🌸</span>'}
        <span class="inv-producto__nombre-wrap">
          <span class="inv-producto__nombre">${escapeHtml(p.nombre)}</span>
          ${p.descripcion ? `<span class="inv-producto__desc">${escapeHtml(p.descripcion)}</span>` : ''}
        </span>
        ${precioBadge}
      </div>
      <div class="inv-producto__controls">
        <label class="inv-mini-label">Stock <input type="number" class="inv-stock-input" data-producto-id="${p.id}" value="${p.stock}" min="0" /></label>
        <label class="inv-mini-label">Costo $ <input type="number" class="inv-costo-input" data-producto-id="${p.id}" value="${p.costo ?? 0}" min="0" step="1" /></label>
        <label class="inv-mini-label">Categoría
          <select class="inv-categoria-select" data-id="${fp.id}">
            ${categorias.map((c) => `<option value="${c.id}" ${fp.categoria_precio_id === c.id ? 'selected' : ''}>${escapeHtml(c.nombre)} — ${formatMoney(c.precio)}</option>`).join('')}
            <option value="" ${fp.categoria_precio_id ? '' : 'selected'}>Sin categoría — precio individual</option>
          </select>
        </label>
      </div>
      <div class="inv-producto__acciones">
        <button class="btn-accion" data-action="editar-nombre" data-producto-id="${p.id}" data-producto-nombre="${escapeHtml(p.nombre)}" title="Cambiar el nombre de este producto">
          <svg class="icon" aria-hidden="true"><use href="#i-editar"/></svg> Nombre
        </button>
        <button class="btn-accion" data-action="editar-descripcion" data-producto-id="${p.id}" data-producto-descripcion="${escapeHtml(p.descripcion || '')}" title="Descripción corta (ej. medidas) para distinguir productos con el mismo nombre">
          <svg class="icon" aria-hidden="true"><use href="#i-editar"/></svg> Descripción
        </button>
        <button class="btn-accion" data-action="ver-insumos" data-producto-id="${p.id}" data-producto-nombre="${escapeHtml(p.nombre)}" title="Insumos que este producto descuenta del stock al venderse">
          <svg class="icon" aria-hidden="true"><use href="#i-inventario"/></svg> Insumos
        </button>
        <button class="btn-accion" data-action="quitar-de-feria" data-id="${fp.id}" title="Se quita de esta feria; sigue en las demás">
          <svg class="icon" aria-hidden="true"><use href="#i-quitar"/></svg> Quitar de la feria
        </button>
        <button class="btn-accion btn-accion--peligro" data-action="eliminar-producto" data-producto-id="${p.id}" title="Borra el producto de TODAS las ferias">
          <svg class="icon" aria-hidden="true"><use href="#i-trash"/></svg> Eliminar
        </button>
      </div>
    </div>
  `;
}

// Agrupados por categoría de precio (con "Sin categoría" al final) para que la lista se
// pueda navegar aunque haya muchos productos en muchas categorías — antes era una sola
// lista plana. Colapsados por default: se ve el panorama (categoría + cuántos productos)
// y se abre solo la que hace falta. Si queda un único grupo, no tiene sentido colapsarlo.
function renderProductos(feria, feriaProductos, categorias, container) {
  const list = container.querySelector('#inv-productos');

  const grupos = categorias.map((c) => ({
    titulo: `${escapeHtml(c.nombre)} — ${formatMoney(c.precio)}`,
    productos: feriaProductos.filter((fp) => fp.categoria_precio_id === c.id),
  }));
  const sinCategoria = feriaProductos.filter((fp) => !fp.categoria_precio_id);
  if (sinCategoria.length > 0) grupos.push({ titulo: 'Sin categoría — precio individual', productos: sinCategoria });

  const gruposConProductos = grupos.filter((g) => g.productos.length > 0);
  const abrirSolo = gruposConProductos.length <= 1;

  list.innerHTML = gruposConProductos.map((g) => `
    <details class="inv-cat-grupo" ${abrirSolo ? 'open' : ''}>
      <summary>
        <span class="inv-cat-grupo__titulo">${g.titulo}</span>
        <span class="inv-cat-grupo__conteo">${g.productos.length === 1 ? '1 producto' : `${g.productos.length} productos`}</span>
      </summary>
      <div class="inv-list">${g.productos.map((fp) => filaProducto(fp, categorias)).join('')}</div>
    </details>
  `).join('') || '<p class="list-empty">Todavía no hay productos en esta feria</p>';

  list.querySelectorAll('.inv-stock-input').forEach((input) => {
    input.addEventListener('change', async () => {
      const val = Number(input.value);
      if (input.value === '' || !Number.isFinite(val) || val < 0) {
        toast('Poné un stock válido (0 o más).');
        input.value = input.defaultValue;
        return;
      }
      const { error } = await mutar(supabase.from('productos').update({ stock: val }).eq('id', input.dataset.productoId), 'No se pudo actualizar el stock');
      if (!error) input.defaultValue = String(val); // el input ya muestra el valor; no re-render (para no perder foco/scroll)
    });
  });

  list.querySelectorAll('.inv-costo-input').forEach((input) => {
    input.addEventListener('change', async () => {
      const val = Number(input.value);
      if (input.value === '' || !Number.isFinite(val) || val < 0) {
        toast('Poné un costo válido (0 o más).');
        input.value = input.defaultValue;
        return;
      }
      const { error } = await mutar(supabase.from('productos').update({ costo: val }).eq('id', input.dataset.productoId), 'No se pudo actualizar el costo');
      if (!error) input.defaultValue = String(val);
    });
  });

  list.querySelectorAll('.inv-categoria-select').forEach((select) => {
    select.addEventListener('change', async () => {
      const { error } = await mutar(supabase.from('feria_productos').update({ categoria_precio_id: select.value || null }).eq('id', select.dataset.id), 'No se pudo actualizar la categoría');
      if (error) return;
      // Actualizar el badge de precio de esta fila en el lugar, sin re-render (respeta un precio_override si lo hay).
      const fila = select.closest('.inv-producto');
      const badge = fila?.querySelector('.inv-producto__precio');
      const override = fila?.dataset.override;
      const cat = categorias.find((c) => c.id === select.value);
      const efectivo = (override != null && override !== '') ? Number(override) : (cat ? cat.precio : null);
      if (badge) {
        badge.textContent = efectivo != null ? formatMoney(efectivo) : 'Sin precio';
        badge.classList.toggle('inv-producto__precio--sin', efectivo == null);
      }
    });
  });

  list.querySelectorAll('[data-action="editar-nombre"]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const actual = btn.dataset.productoNombre;
      const val = await promptDialog('Nuevo nombre del producto:', { value: actual, okLabel: 'Guardar' });
      if (val === null) return; // canceló
      const nombre = val.trim();
      if (!nombre) { toast('El nombre no puede quedar vacío.'); return; }
      if (nombre === actual) return; // sin cambios
      // Es el mismo producto en todas las ferias que lo usan, así que el nombre se
      // actualiza en todas (correcto: es un solo catálogo compartido).
      const { error } = await mutar(supabase.from('productos').update({ nombre }).eq('id', btn.dataset.productoId), 'No se pudo cambiar el nombre');
      if (error) return;
      render(feria, container);
    });
  });

  list.querySelectorAll('[data-action="editar-descripcion"]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const actual = btn.dataset.productoDescripcion;
      const val = await promptDialog('Descripción corta (ej. medidas):', { value: actual, okLabel: 'Guardar' });
      if (val === null) return; // canceló
      const descripcion = val.trim() || null;
      if (descripcion === (actual || null)) return; // sin cambios
      const { error } = await mutar(supabase.from('productos').update({ descripcion }).eq('id', btn.dataset.productoId), 'No se pudo cambiar la descripción');
      if (error) return;
      render(feria, container);
    });
  });

  list.querySelectorAll('[data-action="ver-insumos"]').forEach((btn) => {
    btn.addEventListener('click', () => {
      abrirInsumosProducto({ id: btn.dataset.productoId, nombre: btn.dataset.productoNombre });
    });
  });

  list.querySelectorAll('[data-action="quitar-de-feria"]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const ok = await confirmDialog('¿Quitar este producto de esta feria? Sigue existiendo para otras ferias que lo usen.');
      if (!ok) return;
      await supabase.from('feria_productos').delete().eq('id', btn.dataset.id);
      render(feria, container);
    });
  });

  list.querySelectorAll('[data-action="eliminar-producto"]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const ok = await confirmDialog('¿Eliminar este producto por completo, de TODAS las ferias que lo usan? Las ventas ya registradas se conservan.', { peligro: true });
      if (!ok) return;
      await supabase.from('productos').delete().eq('id', btn.dataset.productoId);
      render(feria, container);
    });
  });
}

async function abrirReutilizarModal(feriaActual, categoriasActuales, container) {
  const { data: otrasFerias } = await supabase.from('ferias').select('*').neq('id', feriaActual.id).order('nombre');
  if (!otrasFerias || otrasFerias.length === 0) {
    toast('No hay otra feria de la cual traer productos todavía');
    return;
  }

  const { dialogo, cerrar } = abrirModal({
    titulo: 'Traer productos de otra feria',
    contenidoHTML: `
      ${campo({ label: '¿De cuál feria?', input: `
        <select id="reutilizar-feria-select" class="input">
          ${otrasFerias.map((f) => `<option value="${f.id}">${escapeHtml(f.emoji)} ${escapeHtml(f.nombre)}</option>`).join('')}
        </select>` })}
      <div id="reutilizar-productos-list" class="inv-list"></div>
      <div class="modal-actions">
        <button class="btn btn--secondary" data-action="cerrar" type="button">Cerrar</button>
      </div>`,
  });

  async function cargarProductosDeFeria(feriaId) {
    const { data: yaEnEstaFeria } = await supabase.from('feria_productos').select('producto_id').eq('feria_id', feriaActual.id);
    const idsYaVinculados = new Set((yaEnEstaFeria || []).map((r) => r.producto_id));

    const { data: fps } = await supabase
      .from('feria_productos')
      .select('producto_id, productos(id, nombre, descripcion, imagen_url, stock)')
      .eq('feria_id', feriaId);

    const disponibles = (fps || []).filter((fp) => !idsYaVinculados.has(fp.producto_id));
    const list = dialogo.querySelector('#reutilizar-productos-list');
    list.innerHTML = disponibles.map((fp) => `
      <div class="row">
        ${fp.productos.imagen_url ? `<img class="row__foto" src="${fp.productos.imagen_url}" alt="" />` : '<span class="row__foto row__foto--sin" aria-hidden="true">🌸</span>'}
        <span class="row__main">${escapeHtml(fp.productos.nombre)}
          ${fp.productos.descripcion ? `<span class="row__meta">${escapeHtml(fp.productos.descripcion)}</span>` : ''}
          <span class="row__meta">stock: ${fp.productos.stock}</span>
        </span>
        <button class="btn-accion" data-action="agregar-producto" data-id="${fp.productos.id}" title="Traer este producto a esta feria">
          <svg class="icon" aria-hidden="true"><use href="#i-traer"/></svg> Traer
        </button>
      </div>
    `).join('') || '<p class="list-empty">No hay productos nuevos para traer de esa feria</p>';
  }

  // Delegación sobre el diálogo: la lista se re-renderiza al cambiar de feria.
  dialogo.addEventListener('click', async (e) => {
    const action = e.target.closest('[data-action]')?.dataset.action;
    if (action === 'cerrar') { cerrar(null); return; }
    if (action === 'agregar-producto') {
      const id = e.target.closest('[data-action]').dataset.id;
      const { error: fpError } = await supabase.from('feria_productos').insert({ feria_id: feriaActual.id, producto_id: id });
      if (fpError) {
        toast('No se pudo vincular el producto a esta feria', { tipo: 'error' });
        return;
      }
      toast('Producto agregado a esta feria', { tipo: 'exito' });
      cerrar(true);
      render(feriaActual, container);
    }
  });

  const select = dialogo.querySelector('#reutilizar-feria-select');
  select.addEventListener('change', () => cargarProductosDeFeria(select.value));
  await cargarProductosDeFeria(select.value);
}
