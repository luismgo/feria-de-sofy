import { supabase } from './supabaseClient.js';
import { confirmDialog, toast, mutar } from './ui.js';
import { renderInsumosSection, abrirRecetaModal } from './insumos.js';

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
      <p class="inv-hint">Agrupá productos por precio: todos los de una categoría valen lo mismo (ej: "Chico" = $100). Así cambiás un precio en un solo lugar.</p>
      <div id="inv-categorias" class="inv-list"></div>
      <form id="form-categoria" class="inv-form">
        <input name="nombre" placeholder="Nombre (ej: Chico)" required />
        <input name="precio" type="number" step="1" min="0" placeholder="Precio" required />
        <button type="submit">Agregar categoría</button>
      </form>
    </section>

    <section class="inv-section">
      <h2>Combos</h2>
      <p class="inv-hint">Un combo vende varios productos juntos a un precio especial (ej: "3 stickers por $250"). Al vender elegís qué productos entran.</p>
      <div id="inv-combos" class="inv-list"></div>
      <form id="form-combo" class="inv-form">
        <input name="nombre" placeholder="Nombre (ej: Combo 3 stickers)" required />
        <input name="cantidad" type="number" min="1" placeholder="Cantidad de productos" required />
        <input name="precio" type="number" step="1" min="0" placeholder="Precio del combo" required />
        <button type="submit">Agregar combo</button>
      </form>
    </section>

    <section class="inv-section" id="inv-productos-section">
      <h2>Productos</h2>
      <div id="inv-productos" class="inv-list"></div>
      <form id="form-producto" class="inv-form">
        <input name="nombre" placeholder="Nombre del producto" required />
        <select name="categoria_precio_id">
          <option value="">Sin categoría</option>
          ${categorias.map((c) => `<option value="${c.id}">${c.nombre} ($${c.precio})</option>`).join('')}
        </select>
        <input name="stock" type="number" min="0" placeholder="Stock inicial" required />
        <input name="foto" type="file" accept="image/*" />
        <button type="submit">Agregar producto</button>
      </form>
      <button id="btn-reutilizar" class="btn btn--secondary" type="button">↩️ Reutilizar producto de otra feria</button>
    </section>

    <section class="inv-section" id="inv-insumos-section"></section>
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

  const { data: productos } = await supabase
    .from('feria_productos')
    .select('id, categoria_precio_id, precio_override, productos(id, nombre, imagen_url, stock, costo)')
    .eq('feria_id', feria.id);

  renderProductos(feria, productos || [], categorias, container);

  renderInsumosSection(container.querySelector('#inv-insumos-section'));

  container.querySelector('#form-producto').addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.target;
    const submitBtn = form.querySelector('button[type="submit"]');
    submitBtn.disabled = true;
    submitBtn.textContent = 'Guardando...';

    let imagen_url = null;
    const file = form.foto.files[0];
    if (file) {
      const path = `${crypto.randomUUID()}-${file.name}`;
      const { error: uploadError } = await supabase.storage.from('productos-fotos').upload(path, file);
      if (!uploadError) {
        imagen_url = supabase.storage.from('productos-fotos').getPublicUrl(path).data.publicUrl;
      } else {
        toast('No se pudo subir la foto, se guarda el producto sin foto');
      }
    }

    const { data: producto, error: prodError } = await supabase
      .from('productos')
      .insert({ nombre: form.nombre.value.trim(), stock: Number(form.stock.value), imagen_url })
      .select()
      .single();

    if (prodError) {
      toast('No se pudo crear el producto');
      submitBtn.disabled = false;
      submitBtn.textContent = 'Agregar producto';
      return;
    }

    const { error: fpError } = await supabase.from('feria_productos').insert({
      feria_id: feria.id,
      producto_id: producto.id,
      categoria_precio_id: form.categoria_precio_id.value || null,
    });

    if (fpError) {
      toast('No se pudo vincular el producto a esta feria');
      submitBtn.disabled = false;
      submitBtn.textContent = 'Agregar producto';
      return;
    }

    render(feria, container);
  });

  container.querySelector('#btn-reutilizar').addEventListener('click', () => abrirReutilizarModal(feria, categorias, container));
}

function renderCategorias(feria, categorias, container) {
  const list = container.querySelector('#inv-categorias');
  list.innerHTML = categorias.map((c) => `
    <div class="inv-row" data-id="${c.id}">
      <span>${c.nombre} — $${c.precio}</span>
      <button class="btn-icon" data-action="eliminar-categoria" data-id="${c.id}" title="Eliminar esta categoría de precio">🗑️</button>
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
      <button class="btn-icon" data-action="toggle-combo" data-id="${c.id}" data-activo="${c.activo}" title="${c.activo ? 'Pausar combo (deja de aparecer al vender)' : 'Activar combo'}">${c.activo ? '⏸️' : '▶️'}</button>
      <button class="btn-icon" data-action="eliminar-combo" data-id="${c.id}" title="Eliminar este combo">🗑️</button>
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

function renderProductos(feria, feriaProductos, categorias, container) {
  const list = container.querySelector('#inv-productos');
  list.innerHTML = feriaProductos.map((fp) => {
    const p = fp.productos;
    const categoria = categorias.find((c) => c.id === fp.categoria_precio_id);
    const precioTexto = fp.precio_override != null
      ? `$${fp.precio_override} (override)`
      : categoria ? `$${categoria.precio} (${categoria.nombre})` : 'sin precio';
    return `
      <div class="inv-row" data-id="${fp.id}">
        ${p.imagen_url ? `<img class="inv-row__foto" src="${p.imagen_url}" alt="${p.nombre}" />` : ''}
        <span>${p.nombre} — ${precioTexto} — Stock: ${p.stock}</span>
        <label class="inv-mini-label">Stock <input type="number" class="inv-stock-input" data-producto-id="${p.id}" value="${p.stock}" min="0" /></label>
        <label class="inv-mini-label">Costo $<input type="number" class="inv-costo-input" data-producto-id="${p.id}" value="${p.costo ?? 0}" min="0" step="1" /></label>
        <select class="inv-categoria-select" data-id="${fp.id}">
          <option value="">Sin categoría</option>
          ${categorias.map((c) => `<option value="${c.id}" ${fp.categoria_precio_id === c.id ? 'selected' : ''}>${c.nombre}</option>`).join('')}
        </select>
        <button class="btn-icon" data-action="ver-receta" data-producto-id="${p.id}" data-producto-nombre="${p.nombre}" title="Ver o editar la receta (insumos que gasta este producto)">🧪</button>
        <button class="btn-icon" data-action="quitar-de-feria" data-id="${fp.id}" title="Quitar de esta feria (sigue existiendo en las demás)">➖</button>
        <button class="btn-icon" data-action="eliminar-producto" data-producto-id="${p.id}" title="Eliminar el producto de TODAS las ferias">🗑️</button>
      </div>
    `;
  }).join('') || '<p class="inv-empty">Todavía no hay productos en esta feria</p>';

  list.querySelectorAll('.inv-stock-input').forEach((input) => {
    input.addEventListener('change', async () => {
      await mutar(supabase.from('productos').update({ stock: Number(input.value) }).eq('id', input.dataset.productoId), 'No se pudo actualizar el stock');
      render(feria, container);
    });
  });

  list.querySelectorAll('.inv-costo-input').forEach((input) => {
    input.addEventListener('change', async () => {
      await mutar(supabase.from('productos').update({ costo: Number(input.value) }).eq('id', input.dataset.productoId), 'No se pudo actualizar el costo');
      render(feria, container);
    });
  });

  list.querySelectorAll('.inv-categoria-select').forEach((select) => {
    select.addEventListener('change', async () => {
      await mutar(supabase.from('feria_productos').update({ categoria_precio_id: select.value || null }).eq('id', select.dataset.id), 'No se pudo actualizar la categoría');
      render(feria, container);
    });
  });

  list.querySelectorAll('[data-action="ver-receta"]').forEach((btn) => {
    btn.addEventListener('click', () => {
      abrirRecetaModal({ id: btn.dataset.productoId, nombre: btn.dataset.productoNombre });
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
      const ok = await confirmDialog('¿Eliminar este producto por completo, de TODAS las ferias que lo usan? Las ventas ya registradas se conservan.');
      if (!ok) return;
      await supabase.from('productos').delete().eq('id', btn.dataset.productoId);
      render(feria, container);
    });
  });
}

async function abrirReutilizarModal(feriaActual, categoriasActuales, container) {
  const { data: otrasFerias } = await supabase.from('ferias').select('*').neq('id', feriaActual.id).order('nombre');
  if (!otrasFerias || otrasFerias.length === 0) {
    toast('No hay otra feria de la cual reutilizar productos todavía');
    return;
  }

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal">
      <p>Elegí de cuál feria traer productos:</p>
      <select id="reutilizar-feria-select">
        ${otrasFerias.map((f) => `<option value="${f.id}">${f.emoji} ${f.nombre}</option>`).join('')}
      </select>
      <div id="reutilizar-productos-list" class="inv-list"></div>
      <div class="modal-actions">
        <button class="btn btn--secondary" data-action="cerrar">Cerrar</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  async function cargarProductosDeFeria(feriaId) {
    const { data: yaEnEstaFeria } = await supabase.from('feria_productos').select('producto_id').eq('feria_id', feriaActual.id);
    const idsYaVinculados = new Set((yaEnEstaFeria || []).map((r) => r.producto_id));

    const { data: fps } = await supabase
      .from('feria_productos')
      .select('producto_id, productos(id, nombre, imagen_url, stock)')
      .eq('feria_id', feriaId);

    const disponibles = (fps || []).filter((fp) => !idsYaVinculados.has(fp.producto_id));
    const list = overlay.querySelector('#reutilizar-productos-list');
    list.innerHTML = disponibles.map((fp) => `
      <div class="inv-row">
        <span>${fp.productos.nombre} (stock: ${fp.productos.stock})</span>
        <button class="btn-icon" data-action="agregar-producto" data-id="${fp.productos.id}" title="Traer este producto a esta feria">➕</button>
      </div>
    `).join('') || '<p class="inv-empty">No hay productos nuevos para traer de esa feria</p>';

    list.querySelectorAll('[data-action="agregar-producto"]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const { error: fpError } = await supabase.from('feria_productos').insert({ feria_id: feriaActual.id, producto_id: btn.dataset.id });
        if (fpError) {
          toast('No se pudo vincular el producto a esta feria');
          return;
        }
        toast('Producto agregado a esta feria');
        document.body.removeChild(overlay);
        render(feriaActual, container);
      });
    });
  }

  const select = overlay.querySelector('#reutilizar-feria-select');
  select.addEventListener('change', () => cargarProductosDeFeria(select.value));
  await cargarProductosDeFeria(select.value);

  overlay.addEventListener('click', (e) => {
    if (e.target.dataset.action === 'cerrar') document.body.removeChild(overlay);
  });
}
