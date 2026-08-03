# Inventario: submenús, precio individual y densidad en Vender — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the design in `docs/superpowers/specs/2026-07-17-inventario-submenus-y-precio-design.md`: turn Inventario into a menu + 4 submenus, remove price-assignment from Vender in favor of a new "Precio individual" field in Inventario, and add a Normal/Compacto density switch to the Vender grid.

**Architecture:** Pure client-side changes to the existing vanilla-JS module structure — no schema, RPC, or build-step changes. `js/inventario.js` gains a module-level `vista` state and a small dispatcher (`render` → `renderMenu` | `renderSubvista`); the four existing section renderers (`renderCategorias`, `renderCombos`, `renderProductos`, `renderInsumosSection`) are wrapped by new per-section fetch+mount functions instead of being rewritten. `js/vender.js` gets a module-level `densidadCompacta` flag (backed by `localStorage`) and the no-price card loses its click handler.

**Tech Stack:** Vanilla JS ES modules (no bundler), Supabase JS client, plain CSS. No test runner exists in this project — verification is `node --check` (confirmed working on this Node install, v24.16.0, which auto-detects ES module syntax) for a syntax gate, plus a manual QA pass in Chrome at the end (existing project convention; see README and prior specs).

## Global Constraints

- No build step, no bundler, no TypeScript — plain `.js` ES modules loaded directly by the browser (`<script type="module">`).
- No automated test suite in this project (confirmed convention) — verification per task is a Node syntax check; full functional verification is a manual Chrome QA pass at the end.
- No changes to `sql/`, `js/app.js`, or the `confirmar_venta`/`anular_venta` RPC contracts.
- Money/price-precedence logic (`precio_override` always wins over category when set) must not change — see `precioEfectivo()` in `vender.js:116-119` and the equivalent inline logic in `inventario.js`.
- Spanish identifiers/copy throughout, matching existing code (`vista`, `categoria`, etc.).
- Comments only where they explain a non-obvious WHY (existing file convention) — no restating what the code does.
- **Never include `Co-Authored-By` or "Generated with Claude Code" trailers in commits** — this repo has a git hook that hard-blocks commits containing AI co-authorship attribution.
- Reuse existing helpers instead of reinventing: `mutar`, `toast`, `escapeHtml`, `formatMoney`, `campo`, `cargando`, `confirmDialog` (all from `js/ui.js`).
- Touch target ≥44px, icon+visible-label where space allows (icon-only is acceptable for compact controls with `aria-label`+`title`, matching the existing `.inv-fab` precedent).

---

## Task 1: Inventario — menu with 4 submenus

**Files:**
- Modify: `js/inventario.js:5-207` (replaces `initInventario` + the old monolithic `render`)
- Modify: `styles.css` (new rules appended after the existing `.inv-cat-grupo` block, i.e. after line 958)

**Interfaces:**
- Consumes: `renderCategorias(feria, categorias, container)`, `renderCombos(feria, combos, container)`, `renderProductos(feria, feriaProductos, categorias, container)` (all unchanged, defined later in the same file), `renderInsumosSection(container)` from `./insumos.js` (unchanged), `bindToggleForm(container, toggleSel, formSel)` / `bindFab(container, fabSel, formSel)` (unchanged, defined in this task).
- Produces: module-level `vista` state (`'menu' | 'categorias' | 'combos' | 'productos' | 'insumos'`); `render(feria, container)` as the single entry point every mutation handler calls to refresh (same name/signature later tasks and existing code — `abrirReutilizarModal` — already call).

- [ ] **Step 1: Replace `initInventario` + `render` in `js/inventario.js`**

Replace lines 5-207 (from `export function initInventario` through the end of the old `render` function, i.e. up to but not including `function renderCategorias(feria, categorias, container) {`) with:

```js
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
```

Everything below this point in the file (`renderCategorias`, `renderCombos`, `filaProducto`, `renderProductos`, `abrirReutilizarModal`) stays exactly as-is for this task.

- [ ] **Step 2: Syntax-check**

Run: `node --check js/inventario.js`
Expected: no output, exit code 0.

- [ ] **Step 3: Add CSS for the menu and the local subview header**

Add after the `.inv-cat-grupo .inv-list { padding-bottom: var(--sp-2); }` line (end of the `.inv-cat-grupo` block) in `styles.css`:

```css

/* ============ Inventario: menú + submenús ============ */

.inv-menu { display: flex; flex-direction: column; }
.inv-menu__item {
  display: flex; align-items: center; gap: var(--sp-3);
  width: 100%;
  min-height: 56px;
  padding: var(--sp-3) 4px;
  background: none; border: none; box-shadow: none;
  border-bottom: 1px solid var(--hairline);
  text-align: left;
  color: var(--ink);
}
.inv-menu__item:last-child { border-bottom: none; }
.inv-menu__icon { font-size: 1.4rem; flex: none; width: 32px; text-align: center; }
.inv-menu__texto { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 1px; }
.inv-menu__titulo { font-weight: 700; }
.inv-menu__conteo { font-size: var(--fs-footnote); color: var(--ink-2); }
.inv-menu__chevron { width: 20px; height: 20px; color: var(--ink-2); flex: none; }

/* Header local de una subvista de Inventario: mismo lenguaje visual que .navbar__back,
   pero local a la pestaña (el navbar global sigue significando "volver a Ferias").
   Sticky con el mismo truco de sangrado que .vender-header (bleed + padding + top negativo
   igual al padding superior de .feria-scroll) para no perder el back en listas largas. */
.inv-subview__header {
  position: sticky; top: -12px; z-index: 4;
  display: flex;
  margin: -12px -16px var(--sp-3);
  padding: 4px 16px;
  background: var(--bg);
  border-bottom: 1px solid var(--hairline);
}
.inv-subview__back {
  display: inline-flex; align-items: center; gap: 2px;
  background: none; border: none; box-shadow: none;
  color: var(--accent-deep);
  font-weight: 600; font-size: var(--fs-subhead);
  padding: 8px 10px; min-height: 44px;
  border-radius: var(--r-sm);
}
.inv-subview__back .icon { width: 22px; height: 22px; margin-left: -6px; }
```

- [ ] **Step 4: Commit**

```bash
git add js/inventario.js styles.css
git commit -m "Inventario: menu con 4 submenus en vez de todo apilado en una pantalla"
```

---

## Task 2: Inventario — campo "Precio individual"

**Files:**
- Modify: `js/inventario.js` (`filaProducto` function; the `.inv-categoria-select` change listener inside `renderProductos`)

**Interfaces:**
- Consumes: `fp.categoria_precio_id`, `fp.precio_override` (existing fields, already fetched by `renderProductosVista` from Task 1).
- Produces: `.inv-precio-input` (new input class), `.inv-precio-individual` (new wrapper class used only for show/hide toggling — no new CSS needed, it reuses `.inv-mini-label` styling and the existing global `.hidden` utility).

- [ ] **Step 1: Add the "Precio individual" input to `filaProducto`**

In `js/inventario.js`, inside the `.inv-producto__controls` block of `filaProducto`, insert a new field between the Costo input and the Categoría select:

Old:
```js
        <label class="inv-mini-label">Costo $ <input type="number" class="inv-costo-input" data-producto-id="${p.id}" value="${p.costo ?? 0}" min="0" step="1" /></label>
        <label class="inv-mini-label">Categoría
```

New:
```js
        <label class="inv-mini-label">Costo $ <input type="number" class="inv-costo-input" data-producto-id="${p.id}" value="${p.costo ?? 0}" min="0" step="1" /></label>
        <label class="inv-mini-label inv-precio-individual${fp.categoria_precio_id ? ' hidden' : ''}">Precio individual $ <input type="number" class="inv-precio-input" data-id="${fp.id}" value="${fp.precio_override ?? ''}" min="0" step="1" /></label>
        <label class="inv-mini-label">Categoría
```

- [ ] **Step 2: Wire the input's `change` listener in `renderProductos`**

In `js/inventario.js`, inside `renderProductos`, add a new `list.querySelectorAll('.inv-precio-input')` block. Insert it right after the existing `list.querySelectorAll('.inv-costo-input')` block (before the `.inv-categoria-select` block):

```js
  list.querySelectorAll('.inv-precio-input').forEach((input) => {
    input.addEventListener('change', async () => {
      const raw = input.value.trim();
      const fila = input.closest('.inv-producto');
      const badge = fila?.querySelector('.inv-producto__precio');

      if (raw === '') {
        // Vacío es válido acá (a diferencia de Stock/Costo): vuelve a "Sin precio"
        // hasta que se cargue un valor o se asigne una categoría.
        const { error } = await mutar(supabase.from('feria_productos').update({ precio_override: null }).eq('id', input.dataset.id), 'No se pudo actualizar el precio individual');
        if (error) { input.value = input.defaultValue; return; }
        input.defaultValue = '';
        if (fila) fila.dataset.override = '';
        if (badge) { badge.textContent = 'Sin precio'; badge.classList.add('inv-producto__precio--sin'); }
        return;
      }

      const val = Number(raw);
      if (!Number.isFinite(val) || val < 0) {
        toast('Poné un precio individual válido (0 o más).');
        input.value = input.defaultValue;
        return;
      }
      const { error } = await mutar(supabase.from('feria_productos').update({ precio_override: val }).eq('id', input.dataset.id), 'No se pudo actualizar el precio individual');
      if (error) { input.value = input.defaultValue; return; }
      input.defaultValue = String(val);
      if (fila) fila.dataset.override = String(val);
      if (badge) { badge.textContent = formatMoney(val); badge.classList.remove('inv-producto__precio--sin'); }
    });
  });

```

- [ ] **Step 3: Extend the `.inv-categoria-select` listener to toggle the new field's visibility**

Old (inside `renderProductos`):
```js
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
```

New:
```js
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
      // El campo "Precio individual" sólo tiene sentido en "Sin categoría".
      const precioIndividual = fila?.querySelector('.inv-precio-individual');
      if (precioIndividual) precioIndividual.classList.toggle('hidden', !!select.value);
    });
  });
```

- [ ] **Step 4: Syntax-check**

Run: `node --check js/inventario.js`
Expected: no output, exit code 0.

- [ ] **Step 5: Commit**

```bash
git add js/inventario.js
git commit -m "Inventario: campo Precio individual para productos sin categoria"
```

---

## Task 3: Vender — quitar "poner precio" de la grilla

**Files:**
- Modify: `js/vender.js:247-261` (inside `renderGrid`)

**Interfaces:**
- Consumes: nothing new.
- Produces: nothing new (no other task depends on this one's internals — it only removes behavior).

- [ ] **Step 1: Replace the no-price branch in `renderGrid`**

Old:
```js
    if (precio == null) {
      card.classList.add('producto-card--sin-precio');
      card.innerHTML = `${media}${nombre}${desc}<span class="producto-card__poner-precio">Tocar para poner precio</span>`;
      card.addEventListener('click', async () => {
        const val = await promptDialog(`Precio de "${p.nombre}" en esta feria:`, { placeholder: 'Ej: 100', tipo: 'number', okLabel: 'Poner precio' });
        if (val === null) return; // el usuario canceló
        const precioNuevo = Number(val);
        if (!Number.isFinite(precioNuevo) || precioNuevo <= 0) { toast('Poné un precio válido mayor a 0.'); return; }
        const { error } = await supabase.from('feria_productos').update({ precio_override: precioNuevo }).eq('id', fp.id);
        if (error) { toast('No se pudo guardar el precio. Probá de nuevo.'); return; }
        loadAndRender(feria, container);
      });
      grid.appendChild(card);
      return; // continúa el forEach
    }
```

New:
```js
    if (precio == null) {
      // Asignar precio ya no pasa por acá (ver Inventario > Productos > Precio individual):
      // la tarjeta queda deshabilitada con un aviso, en vez de abrir un prompt de precio.
      card.classList.add('producto-card--sin-precio');
      card.disabled = true;
      card.innerHTML = `${media}${nombre}${desc}<span class="producto-card__poner-precio">Sin precio — asignalo en Inventario</span>`;
      grid.appendChild(card);
      return; // continúa el forEach
    }
```

- [ ] **Step 2: Syntax-check**

Run: `node --check js/vender.js`
Expected: no output, exit code 0.

- [ ] **Step 3: Commit**

```bash
git add js/vender.js
git commit -m "Vender: sacar poner precio de la grilla, se asigna en Inventario"
```

---

## Task 4: Vender — switch de densidad del grid

**Files:**
- Modify: `js/vender.js` (module state near the top; `initVender`; `renderGrid`'s header + grid creation)
- Modify: `index.html` (new icon symbol in the sprite)
- Modify: `styles.css` (new rules for the header row, the button, and the compact grid)

**Interfaces:**
- Consumes: `#i-densidad` SVG symbol (new, added to `index.html`'s sprite in this task).
- Produces: module-level `densidadCompacta` boolean, `cargarDensidad()` / `guardarDensidad(compacta)` helpers backed by the `localStorage` key `'feria:densidad-grid'` (device-wide, no feria id — matches the existing `carrito:${feriaId}` prefix convention but deliberately un-scoped since this is a device preference, not per-sale state).

- [ ] **Step 1: Add density state + persistence helpers to `js/vender.js`**

Insert after the existing module-level `let` declarations (right after `let ultimoCountDock = 0;`):

```js
let densidadCompacta = false; // preferencia de grilla del dispositivo (no por feria) — ver cargarDensidad/guardarDensidad
const DENSIDAD_KEY = 'feria:densidad-grid';

function cargarDensidad() {
  try { return localStorage.getItem(DENSIDAD_KEY) === 'compacta'; } catch { return false; }
}

function guardarDensidad(compacta) {
  try { localStorage.setItem(DENSIDAD_KEY, compacta ? 'compacta' : 'normal'); } catch { /* almacenamiento bloqueado o lleno: no persiste, la app sigue andando */ }
}
```

- [ ] **Step 2: Load the saved density when entering Vender**

In `initVender`, add `densidadCompacta = cargarDensidad();` alongside the other per-entry resets. Old:
```js
export function initVender(feria) {
  carrito = [];
  metodoPagoActual = 'efectivo';
  clientVentaIdPendiente = null;
  descuentoActual = 0;
  pagaConActual = '';
  filtroBusqueda = '';
  filtroCategoriaActiva = null;
  rankingCongelado = [];
  feriaProductosActuales = [];
  combosActuales = [];
  ultimoCountDock = 0;
```
New:
```js
export function initVender(feria) {
  carrito = [];
  metodoPagoActual = 'efectivo';
  clientVentaIdPendiente = null;
  descuentoActual = 0;
  pagaConActual = '';
  filtroBusqueda = '';
  filtroCategoriaActiva = null;
  rankingCongelado = [];
  feriaProductosActuales = [];
  combosActuales = [];
  ultimoCountDock = 0;
  densidadCompacta = cargarDensidad();
```
(the rest of `initVender` is unchanged)

- [ ] **Step 3: Add the density button next to the search input in `renderGrid`**

Old (the `if (!sinNada) { ... }` header-building block):
```js
  if (!sinNada) {
    const header = document.createElement('div');
    header.className = 'vender-header';

    const buscador = document.createElement('input');
    buscador.className = 'vender-buscador';
    buscador.type = 'search';
    buscador.placeholder = 'Buscar producto...';
    buscador.setAttribute('aria-label', 'Buscar producto');
    buscador.value = filtroBusqueda;
    buscador.addEventListener('input', () => {
      filtroBusqueda = buscador.value;
      const grid = container.querySelector('.productos-grid');
      if (grid) aplicarFiltroBusqueda(grid); // sin re-render: conserva foco y posición del cursor
    });
    header.appendChild(buscador);

    if (categoriasPresentes.length > 0) {
```

New:
```js
  if (!sinNada) {
    const header = document.createElement('div');
    header.className = 'vender-header';

    const fila = document.createElement('div');
    fila.className = 'vender-header__fila';

    const buscador = document.createElement('input');
    buscador.className = 'vender-buscador';
    buscador.type = 'search';
    buscador.placeholder = 'Buscar producto...';
    buscador.setAttribute('aria-label', 'Buscar producto');
    buscador.value = filtroBusqueda;
    buscador.addEventListener('input', () => {
      filtroBusqueda = buscador.value;
      const grid = container.querySelector('.productos-grid');
      if (grid) aplicarFiltroBusqueda(grid); // sin re-render: conserva foco y posición del cursor
    });
    fila.appendChild(buscador);

    const densidadBtn = document.createElement('button');
    densidadBtn.type = 'button';
    densidadBtn.className = 'vender-densidad-btn';
    densidadBtn.setAttribute('aria-pressed', String(densidadCompacta));
    densidadBtn.setAttribute('aria-label', 'Vista compacta de la grilla');
    densidadBtn.title = 'Vista compacta: ver más productos por fila';
    densidadBtn.innerHTML = '<svg class="icon" aria-hidden="true"><use href="#i-densidad"/></svg>';
    densidadBtn.addEventListener('click', () => {
      densidadCompacta = !densidadCompacta;
      guardarDensidad(densidadCompacta);
      const grid = container.querySelector('.productos-grid');
      if (grid) grid.classList.toggle('productos-grid--compacta', densidadCompacta);
      densidadBtn.setAttribute('aria-pressed', String(densidadCompacta));
    });
    fila.appendChild(densidadBtn);

    header.appendChild(fila);

    if (categoriasPresentes.length > 0) {
```

(the `chips` block right after stays exactly as-is; only the preceding `buscador`/`header` wiring changes, and `header.appendChild(chips);` at the end of that block is unchanged)

- [ ] **Step 4: Apply the saved density class when the grid is (re)built**

Old:
```js
  const grid = document.createElement('div');
  grid.className = 'productos-grid';
```
New:
```js
  const grid = document.createElement('div');
  grid.className = `productos-grid${densidadCompacta ? ' productos-grid--compacta' : ''}`;
```

- [ ] **Step 5: Syntax-check**

Run: `node --check js/vender.js`
Expected: no output, exit code 0.

- [ ] **Step 6: Add the new icon symbol to `index.html`**

In `index.html`, add a new `<symbol>` to the sprite, right after the `i-traer` symbol (last one in the sprite):

Old:
```html
    <symbol id="i-traer" viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.5"/><path d="M12 8.5v7M8.5 12h7"/></symbol>
  </svg>
```
New:
```html
    <symbol id="i-traer" viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.5"/><path d="M12 8.5v7M8.5 12h7"/></symbol>
    <symbol id="i-densidad" viewBox="0 0 24 24"><rect x="4" y="4" width="6.5" height="6.5" rx="1.3"/><rect x="13.5" y="4" width="6.5" height="6.5" rx="1.3"/><rect x="4" y="13.5" width="6.5" height="6.5" rx="1.3"/><rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.3"/></symbol>
  </svg>
```

- [ ] **Step 7: Add CSS for the header row, the button, and the compact grid**

Add after the `.chip-categoria.is-active { ... }` block in `styles.css`:

```css

.vender-header__fila { display: flex; gap: var(--sp-2); align-items: center; }
.vender-header__fila .vender-buscador { flex: 1; min-width: 0; margin-bottom: 0; }
.vender-densidad-btn {
  flex: none;
  width: 44px; height: 44px; min-height: 44px;
  display: grid; place-items: center;
  background: var(--surface); color: var(--ink-2);
  border: 1px solid var(--border); box-shadow: var(--shadow-1);
  border-radius: var(--r-md);
}
.vender-densidad-btn[aria-pressed="true"] { background: var(--accent-strong); color: #fff; border-color: var(--accent-strong); }
```

Add after the `.producto-card--sin-precio` / `.producto-card__poner-precio` rules (right before the "Tile 'Otro monto'" comment), still in the same `============ Vender: buscador, combos, grilla ============` section:

```css

/* Densidad Compacto: mismo grid, mínimo más chico + foto/tipografía escalados a juego. */
.productos-grid--compacta { grid-template-columns: repeat(auto-fill, minmax(90px, 1fr)); gap: var(--sp-2); }
.productos-grid--compacta .producto-card { padding: 6px; gap: 2px; font-size: var(--fs-caption); }
.productos-grid--compacta .producto-card img,
.productos-grid--compacta .producto-card__sin-foto { height: 60px; }
.productos-grid--compacta .producto-card__precio { font-size: var(--fs-subhead); }
.productos-grid--compacta .producto-card--otro { min-height: 100px; }
```

Add inside the existing `@media (min-width: 700px) { ... }` block at the end of the file, right after the `.productos-grid { grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); }` line:

```css
  .productos-grid--compacta { grid-template-columns: repeat(auto-fill, minmax(110px, 1fr)); }
```

- [ ] **Step 8: Commit**

```bash
git add js/vender.js index.html styles.css
git commit -m "Vender: switch de densidad Normal/Compacto en la grilla de productos"
```

---

## Task 5: Verificación manual en Chrome

No hay tests automatizados en este proyecto (convención ya vigente) — esta es la verificación real. Server local:

```bash
npx serve .
```

- [ ] **Step 1: Levantar el server local y abrir la app en Chrome (viewport móvil)**

Run: `npx serve .` (o `python -m http.server 8000`), abrir `http://localhost:PORT` en una pestaña de Chrome, iniciar sesión y entrar a una feria con productos existentes.

- [ ] **Step 2: QA de Inventario — menú y submenús**

Entrar a la pestaña Inventario. Verificar:
- Se ve el menú con las 4 filas (Categorías de precio, Combos, Productos, Insumos) y los conteos son correctos.
- Entrar a cada submenú, confirmar que el contenido es el mismo que antes (formularios, listas) y que `‹ Inventario` vuelve al menú.
- Confirmar que Productos conserva el acordeón por categoría y que el FAB "+" solo aparece en esa vista (no en Categorías/Combos/Insumos/menú).

- [ ] **Step 3: QA de Inventario — Precio individual**

Dentro de Productos, tomar un producto con categoría asignada y cambiarlo a "Sin categoría — precio individual": confirmar que aparece el campo "Precio individual $". Cargar un valor y confirmar que el badge de precio de la fila se actualiza. Volver a asignarle una categoría: confirmar que el campo desaparece y el badge vuelve a mostrar el precio de la categoría. Vaciar el campo estando en "Sin categoría": confirmar que el badge pasa a "Sin precio".

- [ ] **Step 4: QA de Vender — tarjeta sin precio**

Buscar (o dejar) un producto en "Sin categoría" sin precio individual cargado. En Vender, confirmar que su tarjeta aparece atenuada/deshabilitada con el texto "Sin precio — asignalo en Inventario" y que tocarla no abre ningún diálogo.

- [ ] **Step 5: QA de Vender — switch de densidad**

Tocar el botón de densidad junto al buscador: confirmar que la grilla pasa a mostrar más columnas (Compacto) y que el botón queda marcado como activo. Recargar la página (mismo navegador): confirmar que la preferencia persiste. Agregar un producto al carrito (dispara un re-render de la grilla): confirmar que la densidad elegida se mantiene.
