# Inventario: editar, buscar, ordenar y alta en popup — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **This plan replaces** `docs/superpowers/plans/2026-07-18-inventario-editar-categorias-combos-insumos-plan.md` — do not execute that one, it's superseded by this broader scope (same field-editing work, plus buscador/orden/popup/sin acordeón).

**Goal:** Implement the design in `docs/superpowers/specs/2026-07-18-inventario-buscador-orden-popup-design.md`: make Categorías, Combos and Insumos fully editable (nombre + their numeric fields), and give all four Inventario sections (Categorías, Combos, Productos, Insumos) a search box, a sort `<select>`, and an "Agregar..." button that opens a popup instead of an inline form. Productos loses its collapsible accordion-by-category — "Categoría" becomes one sort option among others, and the FAB goes away.

**Architecture:** Pure client-side changes to two existing vanilla-JS modules plus two new shared helpers in `js/ui.js`. Each section's "vista" function (`renderCategoriasVista`, `renderCombosVista`, `renderProductosVista`, `renderInsumosSection`) now keeps its fetched array in a closure, renders a toolbar once (search input + sort `<select>` + "Agregar" button), and on every keystroke/change/mutation recomputes a filtered+sorted view and re-renders only the inner list container — never the toolbar itself, so search text and the chosen sort survive every edit. A local `refrescar()` closure (re-fetch + recompute) replaces the old pattern of calling the module-level `render(feria, container)` after a mutation, because that would blow away the toolbar (and lose the reader's search text) since it rebuilds the whole subvista from scratch. `render(feria, container)` keeps its original job of top-level tab navigation (menu ↔ subvista) — untouched.

**Tech Stack:** Vanilla JS ES modules (no bundler), Supabase JS client, plain CSS.

## Global Constraints

- No build step, no bundler, no TypeScript — plain `.js` ES modules loaded directly by the browser (`<script type="module">`).
- No automated test suite in this project (confirmed convention) — verification per task is a Node syntax check; full functional verification is a manual Chrome QA pass at the end.
- No changes to `sql/`, `js/app.js`, `js/vender.js`, or the `confirmar_venta`/`anular_venta` RPC contracts.
- Spanish identifiers/copy throughout, matching existing code.
- Comments only where they explain a non-obvious WHY (existing file convention) — no restating what the code does.
- **Never include `Co-Authored-By` or "Generated with Claude Code" trailers in commits** — this repo has a git hook that hard-blocks commits containing AI co-authorship attribution.
- Reuse existing helpers instead of reinventing: `mutar`, `toast`, `escapeHtml`, `formatMoney`, `promptDialog`, `confirmDialog`, `abrirModal`, `campo`, `cargando`, `comprimirImagen`, `uuid` (all from `js/ui.js`).
- No re-fetch on search/sort — both operate on the array already fetched for the current subvista; only actual data mutations (create/edit/delete) trigger a re-fetch, via each section's own `refrescar()`.
- A criterio no alfabético (precio/cantidad/stock/costo) siempre usa nombre A-Z como desempate.
- Modal forms reuse `.form-alta` for spacing (already done this way in `abrirInsumosProducto`'s `#form-agregar-insumo`) and `.modal-actions` for the button row — no new modal-chrome CSS needed, only new toolbar CSS.

---

## Task 1: Shared filter/sort helpers in `js/ui.js`

**Files:**
- Modify: `js/ui.js` (insert after the `formatMoney` function, i.e. after line 256)

**Interfaces:**
- Produces: `filtrarPorNombre(items, query, getNombre)`, `ordenar(items, criterio, criterios, getNombre)` — consumed by every task below.

- [ ] **Step 1: Add the two helpers**

Insert immediately after this existing block in `js/ui.js` (the `formatMoney` function, ends at line 256):
```js
// Formatea un monto en pesos con separador de miles (ej. 1234 -> "$1.234").
// Locale es-CO: separador de miles con PUNTO, como se lee la plata en Colombia.
export function formatMoney(n) {
  return '$' + Number(n || 0).toLocaleString('es-CO');
}
```

New code to insert right after it (before `comprimirImagen`):
```js

// Filtra por substring de nombre, case-insensitive. Query vacío (o solo espacios) devuelve
// todo sin tocar el array. Usado por los buscadores de Inventario (Categorías, Combos,
// Productos, Insumos) para filtrar en memoria, sin re-fetch.
export function filtrarPorNombre(items, query, getNombre) {
  const q = query.trim().toLowerCase();
  if (!q) return items;
  return items.filter((item) => getNombre(item).toLowerCase().includes(q));
}

const collatorEs = new Intl.Collator('es');

// Ordena por el criterio elegido en un <select> de orden. `criterios` mapea el value del
// select a una función que extrae el valor numérico a comparar; un criterio sin entrada en
// `criterios` (ej. 'nombre') deja el orden puramente alfabético. Todo criterio no alfabético
// usa el nombre como desempate, para que el resultado sea estable ante empates numéricos.
export function ordenar(items, criterio, criterios, getNombre) {
  const extraer = criterios[criterio];
  return [...items].sort((a, b) => {
    if (extraer) {
      const diff = extraer(a) - extraer(b);
      if (diff !== 0) return diff;
    }
    return collatorEs.compare(getNombre(a), getNombre(b));
  });
}
```

- [ ] **Step 2: Syntax-check**

Run: `node --check js/ui.js`
Expected: no output, exit code 0.

- [ ] **Step 3: Commit**

```bash
git add js/ui.js
git commit -m "Inventario: helpers compartidos filtrarPorNombre y ordenar"
```

---

## Task 2: Categorías — buscador, orden, alta en popup, editar nombre y precio

**Files:**
- Modify: `js/inventario.js` — the import line (line 2), `renderCategoriasVista` (~lines 104-145), `renderCategorias` (~lines 294-313), plus a new `abrirAltaCategoriaModal` function.
- Modify: `styles.css` — new `.inv-toolbar` rules.

**Interfaces:**
- Consumes: `filtrarPorNombre`, `ordenar` (Task 1), plus already-imported `mutar`, `toast`, `escapeHtml`, `formatMoney`, `promptDialog`, `confirmDialog`, `abrirModal`, `campo`, `cargando`.
- Produces: nothing consumed by other tasks — Categorías, Combos, Productos, Insumos are independent sections (each has its own vista function, own toolbar, own modal).

- [ ] **Step 1: Add the new helpers to the `ui.js` import**

Old (`js/inventario.js:2`):
```js
import { confirmDialog, toast, mutar, escapeHtml, formatMoney, uuid, promptDialog, abrirModal, campo, cargando, comprimirImagen } from './ui.js';
```

New:
```js
import { confirmDialog, toast, mutar, escapeHtml, formatMoney, uuid, promptDialog, abrirModal, campo, cargando, comprimirImagen, filtrarPorNombre, ordenar } from './ui.js';
```

- [ ] **Step 2: Replace `renderCategoriasVista`**

Old:
```js
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
```

New:
```js
async function renderCategoriasVista(feria, container) {
  const body = container.querySelector('.inv-subview__body');
  body.innerHTML = cargando('Cargando categorías...', { kind: 'lista' });
  const { data, error } = await supabase.from('categorias_precio').select('*').eq('feria_id', feria.id).order('orden');
  if (error) {
    body.innerHTML = '<p class="error">No se pudo cargar — revisá la conexión</p>';
    return;
  }
  let categorias = data;
  let filtro = '';
  let orden = 'nombre';

  body.innerHTML = `
    <section class="card">
      <h2>Categorías de precio</h2>
      <p class="card__hint">Agrupá productos por precio: todos los de una categoría valen lo mismo (ej: "Chico" = $100). Así cambiás un precio en un solo lugar.</p>
      <div class="inv-toolbar">
        <input type="search" class="input inv-buscador" placeholder="Buscar categoría..." aria-label="Buscar categoría" />
        <select class="input inv-orden-select" aria-label="Ordenar por">
          <option value="nombre">Nombre (A-Z)</option>
          <option value="precio">Precio</option>
        </select>
        <button type="button" class="btn-accion" data-action="abrir-alta-categoria">
          <svg class="icon" aria-hidden="true"><use href="#i-mas"/></svg> Agregar
        </button>
      </div>
      <div id="inv-categorias" class="inv-list"></div>
    </section>
  `;

  const CRITERIOS = { precio: (c) => c.precio };

  function actualizarLista() {
    const filtradas = filtrarPorNombre(categorias, filtro, (c) => c.nombre);
    const ordenadas = ordenar(filtradas, orden, CRITERIOS, (c) => c.nombre);
    renderCategorias(ordenadas, categorias.length > 0, container, refrescar);
  }

  async function refrescar() {
    const { data: nuevas } = await supabase.from('categorias_precio').select('*').eq('feria_id', feria.id).order('orden');
    categorias = nuevas || [];
    actualizarLista();
  }

  body.querySelector('.inv-buscador').addEventListener('input', (e) => {
    filtro = e.target.value;
    actualizarLista();
  });
  body.querySelector('.inv-orden-select').addEventListener('change', (e) => {
    orden = e.target.value;
    actualizarLista();
  });
  body.querySelector('[data-action="abrir-alta-categoria"]').addEventListener('click', () => {
    abrirAltaCategoriaModal(feria, categorias, refrescar);
  });

  actualizarLista();
}

// Modal de alta de categoría — reemplaza al viejo formulario inline colapsado.
function abrirAltaCategoriaModal(feria, categoriasActuales, refrescar) {
  const { dialogo, cerrar } = abrirModal({
    titulo: 'Agregar categoría',
    contenidoHTML: `
      <form id="form-categoria" class="form-alta">
        ${campo({ label: 'Nombre', input: '<input name="nombre" class="input" placeholder="Ej: Chico" required autofocus />' })}
        ${campo({ label: 'Precio en pesos', input: '<input name="precio" class="input" type="number" step="1" min="0" inputmode="numeric" placeholder="Ej: 5000" required />' })}
        <div class="modal-actions">
          <button type="button" class="btn btn--secondary" data-action="cerrar">Cancelar</button>
          <button type="submit" class="btn btn--primary">Guardar categoría</button>
        </div>
      </form>
    `,
  });

  dialogo.addEventListener('click', (e) => {
    if (e.target.closest('[data-action="cerrar"]')) cerrar(null);
  });

  dialogo.querySelector('#form-categoria').addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.target;
    const submitBtn = form.querySelector('button[type="submit"]');
    submitBtn.disabled = true;
    const { error: insertError } = await mutar(supabase.from('categorias_precio').insert({
      feria_id: feria.id,
      nombre: form.nombre.value.trim(),
      precio: Number(form.precio.value),
      orden: categoriasActuales.length,
    }), 'No se pudo crear la categoría');
    if (insertError) { submitBtn.disabled = false; return; }
    cerrar(true);
    refrescar();
  });
}
```

- [ ] **Step 3: Replace `renderCategorias`**

Old:
```js
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
```

New:
```js
function renderCategorias(categoriasAMostrar, hayCategorias, container, refrescar) {
  const list = container.querySelector('#inv-categorias');
  list.innerHTML = categoriasAMostrar.map((c) => `
    <div class="row" data-id="${c.id}">
      <span class="row__nombre">${escapeHtml(c.nombre)}</span>
      <label class="inv-mini-label">Precio $<input type="number" class="cat-precio-input" data-id="${c.id}" value="${c.precio}" min="0" step="1" /></label>
      <div class="row__actions">
        <button class="btn-accion" data-action="editar-nombre-categoria" data-id="${c.id}" data-nombre="${escapeHtml(c.nombre)}" title="Cambiar el nombre de esta categoría">
          <svg class="icon" aria-hidden="true"><use href="#i-editar"/></svg> Nombre
        </button>
        <button class="btn-accion btn-accion--peligro" data-action="eliminar-categoria" data-id="${c.id}" title="Eliminar esta categoría de precio">
          <svg class="icon" aria-hidden="true"><use href="#i-trash"/></svg> Eliminar
        </button>
      </div>
    </div>
  `).join('') || (hayCategorias ? '<p class="list-empty">No se encontraron categorías con ese nombre</p>' : '<p class="list-empty">Todavía no hay categorías de precio</p>');

  list.querySelectorAll('.cat-precio-input').forEach((input) => {
    input.addEventListener('change', async () => {
      const val = Number(input.value);
      if (input.value === '' || !Number.isFinite(val) || val < 0) {
        toast('Poné un precio válido (0 o más).');
        input.value = input.defaultValue;
        return;
      }
      const { error } = await mutar(supabase.from('categorias_precio').update({ precio: val }).eq('id', input.dataset.id), 'No se pudo actualizar el precio');
      if (!error) input.defaultValue = String(val);
    });
  });

  list.querySelectorAll('[data-action="editar-nombre-categoria"]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const actual = btn.dataset.nombre;
      const val = await promptDialog('Nuevo nombre de la categoría:', { value: actual, okLabel: 'Guardar' });
      if (val === null) return; // canceló
      const nombre = val.trim();
      if (!nombre) { toast('El nombre no puede quedar vacío.'); return; }
      if (nombre === actual) return; // sin cambios
      const { error } = await mutar(supabase.from('categorias_precio').update({ nombre }).eq('id', btn.dataset.id), 'No se pudo cambiar el nombre');
      if (error) return;
      refrescar();
    });
  });

  list.querySelectorAll('[data-action="eliminar-categoria"]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const ok = await confirmDialog('¿Eliminar esta categoría de precio? Los productos que la usan quedarán sin categoría.', { peligro: true });
      if (!ok) return;
      await supabase.from('categorias_precio').delete().eq('id', btn.dataset.id);
      refrescar();
    });
  });
}
```

- [ ] **Step 4: Syntax-check**

Run: `node --check js/inventario.js`
Expected: no output, exit code 0.

- [ ] **Step 5: Add the toolbar CSS**

Insert immediately after this existing line in `styles.css` (`.inv-list`, line 929):
```css
.inv-list { display: flex; flex-direction: column; }
```

New code to insert right after it (before `.inv-mini-label`):
```css

/* Barra de herramientas de una sección de Inventario: buscador + orden + botón Agregar.
   Vive arriba de la lista (antes al final, colapsado); en pantallas angostas envuelve. */
.inv-toolbar { display: flex; flex-wrap: wrap; gap: var(--sp-2); align-items: center; margin-bottom: var(--sp-3); }
.inv-toolbar .inv-buscador { flex: 1; min-width: 140px; }
.inv-toolbar .inv-orden-select { flex: none; width: auto; min-width: 140px; }
```

- [ ] **Step 6: Commit**

```bash
git add js/inventario.js styles.css
git commit -m "Inventario: buscador, orden, alta en popup y editar nombre/precio en categorias"
```

---

## Task 3: Combos — buscador, orden, alta en popup, editar nombre/cantidad/precio

**Files:**
- Modify: `js/inventario.js` — `renderCombosVista` (~lines 147-189), `renderCombos` (~lines 315-346), plus a new `abrirAltaComboModal` function.

**Interfaces:**
- Consumes: `filtrarPorNombre`, `ordenar` (Task 1, already imported by Task 2).
- Produces: nothing consumed elsewhere.

- [ ] **Step 1: Replace `renderCombosVista`**

Old:
```js
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
```

New:
```js
async function renderCombosVista(feria, container) {
  const body = container.querySelector('.inv-subview__body');
  body.innerHTML = cargando('Cargando combos...', { kind: 'lista' });
  const { data, error } = await supabase.from('combos').select('*').eq('feria_id', feria.id).order('nombre');
  if (error) {
    body.innerHTML = '<p class="error">No se pudo cargar — revisá la conexión</p>';
    return;
  }
  let combos = data;
  let filtro = '';
  let orden = 'nombre';

  body.innerHTML = `
    <section class="card">
      <h2>Combos</h2>
      <p class="card__hint">Un combo vende varios productos juntos a un precio especial (ej: "3 stickers por $250"). Al vender elegís qué productos entran.</p>
      <div class="inv-toolbar">
        <input type="search" class="input inv-buscador" placeholder="Buscar combo..." aria-label="Buscar combo" />
        <select class="input inv-orden-select" aria-label="Ordenar por">
          <option value="nombre">Nombre (A-Z)</option>
          <option value="precio">Precio</option>
          <option value="cantidad">Cantidad</option>
        </select>
        <button type="button" class="btn-accion" data-action="abrir-alta-combo">
          <svg class="icon" aria-hidden="true"><use href="#i-mas"/></svg> Agregar
        </button>
      </div>
      <div id="inv-combos" class="inv-list"></div>
    </section>
  `;

  const CRITERIOS = { precio: (c) => c.precio, cantidad: (c) => c.cantidad };

  function actualizarLista() {
    const filtrados = filtrarPorNombre(combos, filtro, (c) => c.nombre);
    const ordenados = ordenar(filtrados, orden, CRITERIOS, (c) => c.nombre);
    renderCombos(ordenados, combos.length > 0, container, refrescar);
  }

  async function refrescar() {
    const { data: nuevos } = await supabase.from('combos').select('*').eq('feria_id', feria.id).order('nombre');
    combos = nuevos || [];
    actualizarLista();
  }

  body.querySelector('.inv-buscador').addEventListener('input', (e) => {
    filtro = e.target.value;
    actualizarLista();
  });
  body.querySelector('.inv-orden-select').addEventListener('change', (e) => {
    orden = e.target.value;
    actualizarLista();
  });
  body.querySelector('[data-action="abrir-alta-combo"]').addEventListener('click', () => {
    abrirAltaComboModal(feria, refrescar);
  });

  actualizarLista();
}

// Modal de alta de combo — reemplaza al viejo formulario inline colapsado.
function abrirAltaComboModal(feria, refrescar) {
  const { dialogo, cerrar } = abrirModal({
    titulo: 'Agregar combo',
    contenidoHTML: `
      <form id="form-combo" class="form-alta">
        ${campo({ label: 'Nombre', input: '<input name="nombre" class="input" placeholder="Ej: Combo 3 stickers" required autofocus />' })}
        ${campo({ label: 'Cantidad de productos que incluye', input: '<input name="cantidad" class="input" type="number" min="1" inputmode="numeric" placeholder="Ej: 3" required />' })}
        ${campo({ label: 'Precio del combo en pesos', input: '<input name="precio" class="input" type="number" step="1" min="0" inputmode="numeric" placeholder="Ej: 12000" required />' })}
        <div class="modal-actions">
          <button type="button" class="btn btn--secondary" data-action="cerrar">Cancelar</button>
          <button type="submit" class="btn btn--primary">Guardar combo</button>
        </div>
      </form>
    `,
  });

  dialogo.addEventListener('click', (e) => {
    if (e.target.closest('[data-action="cerrar"]')) cerrar(null);
  });

  dialogo.querySelector('#form-combo').addEventListener('submit', async (e) => {
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
    cerrar(true);
    refrescar();
  });
}
```

- [ ] **Step 2: Replace `renderCombos`**

Old:
```js
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
```

New:
```js
function renderCombos(combosAMostrar, hayCombos, container, refrescar) {
  const list = container.querySelector('#inv-combos');
  list.innerHTML = combosAMostrar.map((c) => `
    <div class="row" data-id="${c.id}">
      <span class="row__nombre">${escapeHtml(c.nombre)}${c.activo ? '' : ' (en pausa)'}</span>
      <label class="inv-mini-label">Cantidad <input type="number" class="combo-cantidad-input" data-id="${c.id}" value="${c.cantidad}" min="1" /></label>
      <label class="inv-mini-label">Precio $<input type="number" class="combo-precio-input" data-id="${c.id}" value="${c.precio}" min="0" step="1" /></label>
      <div class="row__actions">
        <button class="btn-accion" data-action="editar-nombre-combo" data-id="${c.id}" data-nombre="${escapeHtml(c.nombre)}" title="Cambiar el nombre de este combo">
          <svg class="icon" aria-hidden="true"><use href="#i-editar"/></svg> Nombre
        </button>
        <button class="btn-accion" data-action="toggle-combo" data-id="${c.id}" data-activo="${c.activo}" title="${c.activo ? 'Deja de aparecer al vender' : 'Vuelve a aparecer al vender'}">
          <svg class="icon" aria-hidden="true"><use href="#i-${c.activo ? 'pausa' : 'play'}"/></svg> ${c.activo ? 'Pausar' : 'Activar'}
        </button>
        <button class="btn-accion btn-accion--peligro" data-action="eliminar-combo" data-id="${c.id}" title="Eliminar este combo">
          <svg class="icon" aria-hidden="true"><use href="#i-trash"/></svg> Eliminar
        </button>
      </div>
    </div>
  `).join('') || (hayCombos ? '<p class="list-empty">No se encontraron combos con ese nombre</p>' : '<p class="list-empty">Todavía no hay combos</p>');

  list.querySelectorAll('.combo-cantidad-input').forEach((input) => {
    input.addEventListener('change', async () => {
      const val = Number(input.value);
      if (input.value === '' || !Number.isInteger(val) || val < 1) {
        toast('Poné una cantidad válida (1 o más).');
        input.value = input.defaultValue;
        return;
      }
      const { error } = await mutar(supabase.from('combos').update({ cantidad: val }).eq('id', input.dataset.id), 'No se pudo actualizar la cantidad');
      if (!error) input.defaultValue = String(val);
    });
  });

  list.querySelectorAll('.combo-precio-input').forEach((input) => {
    input.addEventListener('change', async () => {
      const val = Number(input.value);
      if (input.value === '' || !Number.isFinite(val) || val < 0) {
        toast('Poné un precio válido (0 o más).');
        input.value = input.defaultValue;
        return;
      }
      const { error } = await mutar(supabase.from('combos').update({ precio: val }).eq('id', input.dataset.id), 'No se pudo actualizar el precio');
      if (!error) input.defaultValue = String(val);
    });
  });

  list.querySelectorAll('[data-action="editar-nombre-combo"]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const actual = btn.dataset.nombre;
      const val = await promptDialog('Nuevo nombre del combo:', { value: actual, okLabel: 'Guardar' });
      if (val === null) return; // canceló
      const nombre = val.trim();
      if (!nombre) { toast('El nombre no puede quedar vacío.'); return; }
      if (nombre === actual) return; // sin cambios
      const { error } = await mutar(supabase.from('combos').update({ nombre }).eq('id', btn.dataset.id), 'No se pudo cambiar el nombre');
      if (error) return;
      refrescar();
    });
  });

  list.querySelectorAll('[data-action="toggle-combo"]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      await supabase.from('combos').update({ activo: btn.dataset.activo !== 'true' }).eq('id', btn.dataset.id);
      refrescar();
    });
  });

  list.querySelectorAll('[data-action="eliminar-combo"]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const ok = await confirmDialog('¿Eliminar este combo?', { peligro: true });
      if (!ok) return;
      await supabase.from('combos').delete().eq('id', btn.dataset.id);
      refrescar();
    });
  });
}
```

- [ ] **Step 3: Syntax-check**

Run: `node --check js/inventario.js`
Expected: no output, exit code 0.

- [ ] **Step 4: Commit**

```bash
git add js/inventario.js
git commit -m "Inventario: buscador, orden, alta en popup y editar nombre/cantidad/precio en combos"
```

---

## Task 4: Productos — buscador, orden (incl. Categoría), alta en popup, sin acordeón ni FAB

**Files:**
- Modify: `js/inventario.js` — `renderProductosVista` (~lines 191-292), `filaProducto` (~lines 350-397), `renderProductos` (~lines 403-555), `abrirReutilizarModal` (~lines 557-623); delete `bindToggleForm` (~lines 16-23) and `bindFab` (~lines 28-37), now unused by every section.
- Modify: `styles.css` — replace the `<details>`-specific accordion rules with a fixed-subtitle style.

**Interfaces:**
- Consumes: `filtrarPorNombre`, `ordenar` (Task 1).
- Produces: `precioEfectivo(fp, categorias)` — module-level helper, used only within this file (badge display and the "Precio" sort criterion).

- [ ] **Step 1: Delete `bindToggleForm` and `bindFab`**

Delete these two functions entirely (nothing calls them anymore after this task — Categorías/Combos stopped in Tasks 2-3, Productos stops below):
```js
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
```

- [ ] **Step 2: Replace `renderProductosVista`**

Old:
```js
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

New:
```js
async function renderProductosVista(feria, container) {
  const body = container.querySelector('.inv-subview__body');
  body.innerHTML = cargando('Cargando productos...', { kind: 'lista' });

  const { data: categorias, error: catError } = await supabase.from('categorias_precio').select('*').eq('feria_id', feria.id).order('orden');
  if (catError) {
    body.innerHTML = '<p class="error">No se pudo cargar — revisá la conexión</p>';
    return;
  }

  const { data: productosData } = await supabase
    .from('feria_productos')
    .select('id, categoria_precio_id, precio_override, productos(id, nombre, descripcion, imagen_url, stock, costo)')
    .eq('feria_id', feria.id);
  let feriaProductos = productosData || [];
  let filtro = '';
  let orden = 'nombre';

  body.innerHTML = `
    <section class="card" id="inv-productos-section">
      <h2>Productos</h2>
      <p class="card__hint">Lo que vendés. El stock es compartido entre todas tus ferias; el precio se define por feria.</p>
      <div class="inv-toolbar">
        <input type="search" class="input inv-buscador" placeholder="Buscar producto..." aria-label="Buscar producto" />
        <select class="input inv-orden-select" aria-label="Ordenar por">
          <option value="nombre">Nombre (A-Z)</option>
          <option value="categoria">Categoría</option>
          <option value="precio">Precio</option>
          <option value="stock">Stock</option>
        </select>
        <div class="inv-productos-acciones">
          <button type="button" class="btn-accion" data-action="abrir-alta-producto">
            <svg class="icon" aria-hidden="true"><use href="#i-mas"/></svg> Agregar
          </button>
          <button type="button" class="btn-accion" data-action="abrir-reutilizar" title="Traer a esta feria un producto que ya existe en otra">
            <svg class="icon" aria-hidden="true"><use href="#i-anular"/></svg> Traer de otra feria
          </button>
        </div>
      </div>
      <div id="inv-productos" class="inv-list"></div>
    </section>
  `;

  function actualizarLista() {
    const filtrados = filtrarPorNombre(feriaProductos, filtro, (fp) => fp.productos.nombre);
    const CRITERIOS = {
      precio: (fp) => { const v = precioEfectivo(fp, categorias); return v == null ? Infinity : v; },
      stock: (fp) => fp.productos.stock,
    };
    const aMostrar = orden === 'categoria' ? filtrados : ordenar(filtrados, orden, CRITERIOS, (fp) => fp.productos.nombre);
    renderProductos(aMostrar, orden, feriaProductos.length > 0, categorias, container, refrescar);
  }

  async function refrescar() {
    const { data: nuevos } = await supabase
      .from('feria_productos')
      .select('id, categoria_precio_id, precio_override, productos(id, nombre, descripcion, imagen_url, stock, costo)')
      .eq('feria_id', feria.id);
    feriaProductos = nuevos || [];
    actualizarLista();
  }

  body.querySelector('.inv-buscador').addEventListener('input', (e) => {
    filtro = e.target.value;
    actualizarLista();
  });
  body.querySelector('.inv-orden-select').addEventListener('change', (e) => {
    orden = e.target.value;
    actualizarLista();
  });
  body.querySelector('[data-action="abrir-alta-producto"]').addEventListener('click', () => {
    abrirAltaProductoModal(feria, categorias, refrescar);
  });
  body.querySelector('[data-action="abrir-reutilizar"]').addEventListener('click', () => {
    abrirReutilizarModal(feria, categorias, refrescar);
  });

  actualizarLista();
}

// Modal de alta de producto — reemplaza al viejo formulario inline colapsado + FAB
// (el botón "Agregar" ahora vive siempre visible en la barra de herramientas de arriba).
function abrirAltaProductoModal(feria, categorias, refrescar) {
  const { dialogo, cerrar } = abrirModal({
    titulo: 'Agregar producto',
    claseExtra: 'modal--combo',
    contenidoHTML: `
      <form id="form-producto" class="form-alta">
        ${campo({ label: 'Nombre del producto', input: '<input name="nombre" class="input" placeholder="Ej: Sticker mariposa" required autofocus />' })}
        ${campo({ label: 'Descripción (opcional)', hint: 'Ej: medidas. Útil para distinguir productos con el mismo nombre.', input: '<input name="descripcion" class="input" placeholder="Ej: 5x3cm" />' })}
        ${campo({ label: 'Categoría de precio', hint: 'La mayoría de los productos van en una categoría de precio. Elegí "Sin categoría" solo si este necesita un precio propio (se pone después, en la lista).', input: `
          <select name="categoria_precio_id" class="input">
            ${categorias.map((c) => `<option value="${c.id}">${escapeHtml(c.nombre)} (${formatMoney(c.precio)})</option>`).join('')}
            <option value="">Sin categoría — precio individual</option>
          </select>` })}
        ${campo({ label: 'Stock inicial', input: '<input name="stock" class="input" type="number" min="0" inputmode="numeric" placeholder="Ej: 20" required />' })}
        ${campo({ label: 'Foto (opcional)', input: '<input name="foto" class="input input--file" type="file" accept="image/*" />' })}
        <div class="modal-actions">
          <button type="button" class="btn btn--secondary" data-action="cerrar">Cancelar</button>
          <button type="submit" class="btn btn--primary">Guardar producto</button>
        </div>
      </form>
    `,
  });

  dialogo.addEventListener('click', (e) => {
    if (e.target.closest('[data-action="cerrar"]')) cerrar(null);
  });

  dialogo.querySelector('#form-producto').addEventListener('submit', async (e) => {
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

    cerrar(true);
    refrescar();
  });
}
```

- [ ] **Step 3: Replace `filaProducto` to use the new `precioEfectivo` helper**

Old:
```js
// Fila de un producto (sin cambios de comportamiento — solo se movió a función aparte
// para poder agruparla por categoría en renderProductos).
function filaProducto(fp, categorias) {
  const p = fp.productos;
  const categoria = categorias.find((c) => c.id === fp.categoria_precio_id);
  const precio = fp.precio_override != null ? fp.precio_override : (categoria ? categoria.precio : null);
  const precioBadge = precio != null
```

New:
```js
// Precio final de un producto en esta feria: precio_override manda si está seteado, si no el
// de su categoría; null si no tiene ninguno de los dos (queda "Sin precio"). Se reusa tanto acá
// como criterio de orden por precio en renderProductosVista.
function precioEfectivo(fp, categorias) {
  if (fp.precio_override != null) return fp.precio_override;
  const categoria = categorias.find((c) => c.id === fp.categoria_precio_id);
  return categoria ? categoria.precio : null;
}

// Fila de un producto (sin cambios de comportamiento — solo se movió a función aparte
// para poder agruparla por categoría en renderProductos).
function filaProducto(fp, categorias) {
  const p = fp.productos;
  const precio = precioEfectivo(fp, categorias);
  const precioBadge = precio != null
```

(el resto de `filaProducto`, debajo de esta línea, queda igual — no se toca.)

- [ ] **Step 4: Replace `renderProductos`**

Old (reemplaza desde el comentario de agrupado hasta el final de la función, es decir todo el bloque entre `filaProducto` y `abrirReutilizarModal`):
```js
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
```

New:
```js
// Agrupa por categoría de precio (con "Sin categoría" al final), A-Z dentro de cada grupo.
// Usado solo cuando el orden elegido es "Categoría" — ya no es un acordeón siempre-on,
// es un modo de orden más entre otros (ver renderProductos).
function agruparPorCategoria(feriaProductos, categorias) {
  const grupos = categorias.map((c) => ({
    titulo: `${escapeHtml(c.nombre)} — ${formatMoney(c.precio)}`,
    productos: [...feriaProductos.filter((fp) => fp.categoria_precio_id === c.id)].sort((a, b) => a.productos.nombre.localeCompare(b.productos.nombre, 'es')),
  }));
  const sinCategoria = [...feriaProductos.filter((fp) => !fp.categoria_precio_id)].sort((a, b) => a.productos.nombre.localeCompare(b.productos.nombre, 'es'));
  if (sinCategoria.length > 0) grupos.push({ titulo: 'Sin categoría — precio individual', productos: sinCategoria });
  return grupos.filter((g) => g.productos.length > 0);
}

function renderProductos(feriaProductosAMostrar, orden, hayProductos, categorias, container, refrescar) {
  const list = container.querySelector('#inv-productos');

  if (feriaProductosAMostrar.length === 0) {
    list.innerHTML = hayProductos
      ? '<p class="list-empty">No se encontraron productos con ese nombre</p>'
      : '<p class="list-empty">Todavía no hay productos en esta feria</p>';
  } else if (orden === 'categoria') {
    const grupos = agruparPorCategoria(feriaProductosAMostrar, categorias);
    list.innerHTML = grupos.map((g) => `
      <div class="inv-cat-grupo">
        <p class="inv-cat-grupo__titulo-fijo">
          <span>${g.titulo}</span>
          <span class="inv-cat-grupo__conteo">${g.productos.length === 1 ? '1 producto' : `${g.productos.length} productos`}</span>
        </p>
        <div class="inv-list">${g.productos.map((fp) => filaProducto(fp, categorias)).join('')}</div>
      </div>
    `).join('');
  } else {
    list.innerHTML = feriaProductosAMostrar.map((fp) => filaProducto(fp, categorias)).join('');
  }

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
      refrescar();
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
      refrescar();
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
      refrescar();
    });
  });

  list.querySelectorAll('[data-action="eliminar-producto"]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const ok = await confirmDialog('¿Eliminar este producto por completo, de TODAS las ferias que lo usan? Las ventas ya registradas se conservan.', { peligro: true });
      if (!ok) return;
      await supabase.from('productos').delete().eq('id', btn.dataset.productoId);
      refrescar();
    });
  });
}
```

- [ ] **Step 5: Update `abrirReutilizarModal` to take `refrescar` instead of `container`**

Old (la firma y el único punto donde llamaba a `render`):
```js
async function abrirReutilizarModal(feriaActual, categoriasActuales, container) {
```
...
```js
      toast('Producto agregado a esta feria', { tipo: 'exito' });
      cerrar(true);
      render(feriaActual, container);
    }
  });
```

New:
```js
async function abrirReutilizarModal(feriaActual, categoriasActuales, refrescar) {
```
...
```js
      toast('Producto agregado a esta feria', { tipo: 'exito' });
      cerrar(true);
      refrescar();
    }
  });
```

(el resto de `abrirReutilizarModal` — el fetch de otras ferias, `cargarProductosDeFeria`, el resto de la delegación de clicks — queda igual, no se toca.)

- [ ] **Step 6: Syntax-check**

Run: `node --check js/inventario.js`
Expected: no output, exit code 0.

- [ ] **Step 7: Replace the accordion CSS with a fixed-subtitle style**

Old (`styles.css`, the block starting at the "Agrupado de productos..." comment):
```css
/* Agrupado de productos por categoría de precio: colapsado por default (mismo patrón
   de acordeón que .historial-dia en Reportes), para que la lista se pueda navegar
   aunque haya muchos productos en muchas categorías. */
.inv-cat-grupo { border-bottom: 1px solid var(--hairline); }
.inv-cat-grupo:last-child { border-bottom: none; }
.inv-cat-grupo > summary {
  list-style: none;
  display: flex; align-items: center; gap: var(--sp-2);
  min-height: 48px; padding: 10px 0;
  cursor: pointer;
  font-weight: 700;
}
.inv-cat-grupo > summary::-webkit-details-marker { display: none; }
.inv-cat-grupo > summary::after {
  content: '';
  width: 8px; height: 8px;
  border-right: 2px solid var(--ink-2);
  border-bottom: 2px solid var(--ink-2);
  transform: rotate(-45deg);
  margin-left: auto;
  flex: none;
  transition: transform 0.15s ease;
}
.inv-cat-grupo[open] > summary::after { transform: rotate(45deg); }
.inv-cat-grupo__conteo { font-size: var(--fs-caption); font-weight: 500; color: var(--ink-2); white-space: nowrap; }
.inv-cat-grupo .inv-list { padding-bottom: var(--sp-2); }
```

New:
```css
/* Agrupado de productos por categoría de precio cuando el orden elegido es "Categoría":
   ya no es un acordeón colapsable — el subtítulo queda fijo, sin flecha ni <details>. */
.inv-cat-grupo { border-bottom: 1px solid var(--hairline); }
.inv-cat-grupo:last-child { border-bottom: none; }
.inv-cat-grupo__titulo-fijo {
  display: flex; align-items: center; gap: var(--sp-2);
  min-height: 48px; padding: 10px 0;
  font-weight: 700;
}
.inv-cat-grupo__conteo { font-size: var(--fs-caption); font-weight: 500; color: var(--ink-2); white-space: nowrap; }
.inv-cat-grupo .inv-list { padding-bottom: var(--sp-2); }
```

- [ ] **Step 8: Commit**

```bash
git add js/inventario.js styles.css
git commit -m "Inventario: Productos sin acordeon ni FAB, buscador, orden con modo Categoria y alta en popup"
```

---

## Task 5: Insumos — buscador, orden, alta en popup, editar nombre

**Files:**
- Modify: `js/insumos.js` — the import line (line 2), `renderInsumosSection` (lines 9-91), plus new `renderListaInsumos` and `abrirAltaInsumoModal` functions.

**Interfaces:**
- Consumes: `filtrarPorNombre`, `ordenar` (Task 1), `promptDialog` (not yet imported in this file).
- Produces: nothing consumed elsewhere. `abrirInsumosProducto` (unchanged, below this in the same file) keeps working as-is — it reads from `insumos` table directly via `fetchInsumos()`, unrelated to this section's local state.

- [ ] **Step 1: Add `promptDialog`, `filtrarPorNombre`, `ordenar` to the `ui.js` import**

Old (`js/insumos.js:2`):
```js
import { confirmDialog, mutar, toast, escapeHtml, abrirModal, campo } from './ui.js';
```

New:
```js
import { confirmDialog, mutar, toast, escapeHtml, abrirModal, campo, promptDialog, filtrarPorNombre, ordenar } from './ui.js';
```

- [ ] **Step 2: Replace `renderInsumosSection`**

Old (líneas 9-91, toda la función):
```js
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
```

New:
```js
export async function renderInsumosSection(container) {
  let insumos = await fetchInsumos();
  let filtro = '';
  let orden = 'nombre';

  container.innerHTML = `
    <h2>Insumos</h2>
    <p class="card__hint">Empaques y materiales que se descuentan solos al vender, sin venderse ellos mismos (ej. bolsitas).</p>
    <div class="inv-toolbar">
      <input type="search" class="input inv-buscador" placeholder="Buscar insumo..." aria-label="Buscar insumo" />
      <select class="input inv-orden-select" aria-label="Ordenar por">
        <option value="nombre">Nombre (A-Z)</option>
        <option value="stock">Stock</option>
        <option value="costo">Costo</option>
      </select>
      <button type="button" class="btn-accion" data-action="abrir-alta-insumo">
        <svg class="icon" aria-hidden="true"><use href="#i-mas"/></svg> Agregar
      </button>
    </div>
    <div id="inv-insumos" class="inv-list"></div>
  `;

  const CRITERIOS = { stock: (i) => i.stock, costo: (i) => i.costo ?? 0 };

  function actualizarLista() {
    const filtrados = filtrarPorNombre(insumos, filtro, (i) => i.nombre);
    const ordenados = ordenar(filtrados, orden, CRITERIOS, (i) => i.nombre);
    renderListaInsumos(ordenados, insumos.length > 0, container, refrescar);
  }

  async function refrescar() {
    insumos = await fetchInsumos();
    actualizarLista();
  }

  container.querySelector('.inv-buscador').addEventListener('input', (e) => {
    filtro = e.target.value;
    actualizarLista();
  });
  container.querySelector('.inv-orden-select').addEventListener('change', (e) => {
    orden = e.target.value;
    actualizarLista();
  });
  container.querySelector('[data-action="abrir-alta-insumo"]').addEventListener('click', () => {
    abrirAltaInsumoModal(refrescar);
  });

  actualizarLista();
}

function renderListaInsumos(insumosAMostrar, hayInsumos, container, refrescar) {
  const list = container.querySelector('#inv-insumos');
  list.innerHTML = insumosAMostrar.map((i) => `
    <div class="row" data-id="${i.id}">
      <span class="row__nombre">${escapeHtml(i.nombre)}</span>
      <label class="inv-mini-label">Stock <input type="number" class="insumo-stock-input" data-id="${i.id}" value="${i.stock}" min="0" /></label>
      <label class="inv-mini-label">Costo $<input type="number" class="insumo-costo-input" data-id="${i.id}" value="${i.costo ?? 0}" min="0" step="1" /></label>
      <button class="btn-accion btn-accion--sm" data-action="editar-nombre-insumo" data-id="${i.id}" data-nombre="${escapeHtml(i.nombre)}" title="Cambiar el nombre de este insumo">
        <svg class="icon" aria-hidden="true"><use href="#i-editar"/></svg> Nombre
      </button>
      <button class="btn-accion btn-accion--peligro btn-accion--sm" data-action="eliminar-insumo" data-id="${i.id}" title="Eliminar este insumo">
        <svg class="icon" aria-hidden="true"><use href="#i-trash"/></svg> Eliminar
      </button>
    </div>
  `).join('') || (hayInsumos ? '<p class="list-empty">No se encontraron insumos con ese nombre</p>' : '<p class="list-empty">Todavía no hay insumos</p>');

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

  list.querySelectorAll('[data-action="editar-nombre-insumo"]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const actual = btn.dataset.nombre;
      const val = await promptDialog('Nuevo nombre del insumo:', { value: actual, okLabel: 'Guardar' });
      if (val === null) return; // canceló
      const nombre = val.trim();
      if (!nombre) { toast('El nombre no puede quedar vacío.'); return; }
      if (nombre === actual) return; // sin cambios
      const { error } = await mutar(supabase.from('insumos').update({ nombre }).eq('id', btn.dataset.id), 'No se pudo cambiar el nombre');
      if (error) return;
      refrescar();
    });
  });

  list.querySelectorAll('[data-action="eliminar-insumo"]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const ok = await confirmDialog('¿Eliminar este insumo? Se quita también de los productos que lo usaban.', { peligro: true });
      if (!ok) return;
      const { error } = await mutar(supabase.from('insumos').delete().eq('id', btn.dataset.id), 'No se pudo eliminar el insumo');
      if (error) return;
      refrescar();
    });
  });
}

function abrirAltaInsumoModal(refrescar) {
  const { dialogo, cerrar } = abrirModal({
    titulo: 'Agregar insumo',
    contenidoHTML: `
      <form id="form-insumo" class="form-alta">
        ${campo({ label: 'Nombre', input: '<input name="nombre" class="input" placeholder="Ej: Bolsita transparente" required autofocus />' })}
        ${campo({ label: 'Stock inicial', input: '<input name="stock" class="input" type="number" min="0" inputmode="numeric" placeholder="Ej: 100" required />' })}
        ${campo({ label: 'Costo por unidad en pesos', hint: 'Cuánto te cuesta a vos cada uno (para saber tu ganancia más adelante).', input: '<input name="costo" class="input" type="number" min="0" step="1" inputmode="numeric" value="0" />' })}
        <div class="modal-actions">
          <button type="button" class="btn btn--secondary" data-action="cerrar">Cancelar</button>
          <button type="submit" class="btn btn--primary">Guardar insumo</button>
        </div>
      </form>
    `,
  });

  dialogo.addEventListener('click', (e) => {
    if (e.target.closest('[data-action="cerrar"]')) cerrar(null);
  });

  dialogo.querySelector('#form-insumo').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target;
    const submitBtn = f.querySelector('button[type="submit"]');
    submitBtn.disabled = true;
    const { error } = await mutar(supabase.from('insumos').insert({ nombre: f.nombre.value.trim(), stock: Number(f.stock.value), costo: Number(f.costo.value || 0) }), 'No se pudo crear el insumo');
    if (error) { submitBtn.disabled = false; return; }
    cerrar(true);
    refrescar();
  });
}
```

- [ ] **Step 3: Syntax-check**

Run: `node --check js/insumos.js`
Expected: no output, exit code 0.

- [ ] **Step 4: Commit**

```bash
git add js/insumos.js
git commit -m "Inventario: buscador, orden, alta en popup y editar nombre en insumos"
```

---

## Task 6: Verificación manual en Chrome

No hay tests automatizados en este proyecto (convención ya vigente) — esta es la verificación real.

- [ ] **Step 1: Levantar el server local y abrir la app**

Run: `npx serve .` (o `python -m http.server 8000`), abrir `http://localhost:PORT` en Chrome, iniciar sesión y entrar a una feria con al menos 2-3 categorías, combos, productos (algunos con categoría, alguno "Sin categoría") e insumos ya cargados.

- [ ] **Step 2: QA — Categorías**

Buscar por nombre y confirmar filtro en vivo sin perder foco del input. Cambiar el orden a Precio y confirmar el resultado. Tocar "Agregar", confirmar que abre un modal, cargar una categoría nueva y guardar — confirmar que aparece en la lista y que el buscador/orden elegidos no se resetean. Editar nombre (botón + prompt) y precio (input inline) de una categoría existente; confirmar que persisten tras recargar. Eliminar una categoría y confirmar que sigue funcionando igual que antes.

- [ ] **Step 3: QA — Combos**

Mismo QA que Categorías, más: confirmar que el orden por Cantidad funciona, y que Pausar/Activar sigue funcionando igual que antes (incluye el "(en pausa)" junto al nombre).

- [ ] **Step 4: QA — Productos**

Confirmar que no hay FAB ni acordeón por default (lista plana, orden Nombre A-Z). Buscar por nombre. Cambiar el orden a "Categoría" y confirmar subtítulos fijos (sin flecha de colapsar) con productos A-Z dentro de cada uno, incluyendo "Sin categoría" al final si corresponde. Cambiar a "Precio" y confirmar que los productos sin precio quedan al final. Cambiar a "Stock". Tocar "Agregar", confirmar que abre un modal con los mismos campos de antes (nombre, descripción, categoría, stock, foto) y que al guardar aparece en la lista. Tocar "Traer de otra feria" y confirmar que sigue funcionando igual que antes. Confirmar que editar nombre/descripción/stock/costo/precio individual/categoría de un producto sigue funcionando (regresión).

- [ ] **Step 5: QA — Insumos**

Buscar por nombre, cambiar orden (Stock, Costo). Tocar "Agregar", confirmar que abre un modal y que al guardar aparece en la lista. Editar nombre (botón + prompt) y confirmar que se refleja también en el selector de insumos de un producto (Inventario > Productos > un producto > "Insumos").

- [ ] **Step 6: QA — modales en general**

En cualquiera de los 4 modales de alta, confirmar que Escape y tocar el fondo oscuro cierran sin guardar, y que el botón "Cancelar" hace lo mismo.
