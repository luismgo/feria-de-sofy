# Inventario: editar categorías, combos e insumos — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the design in `docs/superpowers/specs/2026-07-18-inventario-editar-categorias-combos-insumos-design.md`: make Categorías de precio (nombre, precio), Combos (nombre, cantidad, precio) and Insumos (nombre) editable, reusing the exact edit pattern Productos already has.

**Architecture:** Pure client-side changes to two existing vanilla-JS modules — no schema, RPC, or build-step changes. `renderCategorias` and `renderCombos` in `js/inventario.js` each gain: one inline numeric input per numeric field (saves on `change`, no re-render — same convention as `.inv-stock-input`/`.inv-costo-input`), and one "Nombre" button that opens `promptDialog` and re-renders on save (same convention as `editar-nombre` in `renderProductos`). `renderInsumosSection` in `js/insumos.js` gains only the "Nombre" button (stock/costo are already editable).

**Tech Stack:** Vanilla JS ES modules (no bundler), Supabase JS client, plain CSS (no new rules needed — reuses `.btn-accion`, `.inv-mini-label`, `.row__actions`, `#i-editar`).

## Global Constraints

- No build step, no bundler, no TypeScript — plain `.js` ES modules loaded directly by the browser (`<script type="module">`).
- No automated test suite in this project (confirmed convention) — verification per task is a Node syntax check; full functional verification is a manual Chrome QA pass at the end.
- No changes to `sql/`, `js/app.js`, `js/vender.js`, or the `confirmar_venta`/`anular_venta` RPC contracts.
- Spanish identifiers/copy throughout, matching existing code.
- Comments only where they explain a non-obvious WHY (existing file convention) — no restating what the code does.
- **Never include `Co-Authored-By` or "Generated with Claude Code" trailers in commits** — this repo has a git hook that hard-blocks commits containing AI co-authorship attribution.
- Reuse existing helpers instead of reinventing: `mutar`, `toast`, `escapeHtml`, `formatMoney`, `promptDialog`, `confirmDialog` (all from `js/ui.js`).
- No new CSS: `.btn-accion`, `.btn-accion--peligro`, `.btn-accion--sm`, `.inv-mini-label`, `.row`, `.row__actions`, and the `#i-editar` sprite symbol already exist and already serve this exact purpose in `filaProducto`.

---

## Task 1: Categorías de precio — editar nombre y precio

**Files:**
- Modify: `js/inventario.js:294-313` (`renderCategorias`)

**Interfaces:**
- Consumes: `mutar`, `toast`, `escapeHtml`, `formatMoney`, `promptDialog`, `confirmDialog` (already imported at the top of the file), module-level `render(feria, container)`.
- Produces: nothing new consumed by other tasks — Categorías, Combos, and Insumos are independent sections.

- [ ] **Step 1: Replace `renderCategorias`**

Replace the full function (`js/inventario.js:294-313`):

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
function renderCategorias(feria, categorias, container) {
  const list = container.querySelector('#inv-categorias');
  list.innerHTML = categorias.map((c) => `
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
  `).join('') || '<p class="list-empty">Todavía no hay categorías de precio</p>';

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
      render(feria, container);
    });
  });

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

- [ ] **Step 2: Syntax-check**

Run: `node --check js/inventario.js`
Expected: no output, exit code 0.

- [ ] **Step 3: Commit**

```bash
git add js/inventario.js
git commit -m "Inventario: editar nombre y precio de categorias"
```

---

## Task 2: Combos — editar nombre, cantidad y precio

**Files:**
- Modify: `js/inventario.js:315-346` (`renderCombos`)

**Interfaces:**
- Consumes: same helpers as Task 1 (`mutar`, `toast`, `escapeHtml`, `formatMoney`, `promptDialog`, `confirmDialog`, module-level `render`).
- Produces: nothing consumed by other tasks.

- [ ] **Step 1: Replace `renderCombos`**

Replace the full function (`js/inventario.js:315-346`):

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
function renderCombos(feria, combos, container) {
  const list = container.querySelector('#inv-combos');
  list.innerHTML = combos.map((c) => `
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
  `).join('') || '<p class="list-empty">Todavía no hay combos</p>';

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
      render(feria, container);
    });
  });

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

- [ ] **Step 2: Syntax-check**

Run: `node --check js/inventario.js`
Expected: no output, exit code 0.

- [ ] **Step 3: Commit**

```bash
git add js/inventario.js
git commit -m "Inventario: editar nombre, cantidad y precio de combos"
```

---

## Task 3: Insumos — editar nombre

**Files:**
- Modify: `js/insumos.js:2` (import)
- Modify: `js/insumos.js:28-37` (row markup inside `renderInsumosSection`)
- Modify: `js/insumos.js:72-80` (listener wiring inside `renderInsumosSection`, insert a new block before the `eliminar-insumo` block)

**Interfaces:**
- Consumes: `promptDialog` (needs to be added to the existing `./ui.js` import), `mutar`, `toast`, `escapeHtml` (already imported), module-level `renderInsumosSection(container)` (existing, used to refresh after a rename — same function it's already called from on insert/delete).
- Produces: nothing consumed by other tasks.

- [ ] **Step 1: Add `promptDialog` to the `ui.js` import**

Old (`js/insumos.js:2`):
```js
import { confirmDialog, mutar, toast, escapeHtml, abrirModal, campo } from './ui.js';
```

New:
```js
import { confirmDialog, mutar, toast, escapeHtml, abrirModal, campo, promptDialog } from './ui.js';
```

- [ ] **Step 2: Add the "Nombre" button to each insumo row**

Old (`js/insumos.js:28-37`):
```js
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
```

New:
```js
  list.innerHTML = insumos.map((i) => `
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
  `).join('') || '<p class="list-empty">Todavía no hay insumos</p>';
```

- [ ] **Step 3: Wire the "Nombre" button, right before the `eliminar-insumo` listener**

Old (`js/insumos.js:72-80`):
```js
  list.querySelectorAll('[data-action="eliminar-insumo"]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const ok = await confirmDialog('¿Eliminar este insumo? Se quita también de los productos que lo usaban.', { peligro: true });
      if (!ok) return;
      const { error } = await mutar(supabase.from('insumos').delete().eq('id', btn.dataset.id), 'No se pudo eliminar el insumo');
      if (error) return;
      renderInsumosSection(container);
    });
  });
```

New:
```js
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
      renderInsumosSection(container);
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
```

- [ ] **Step 4: Syntax-check**

Run: `node --check js/insumos.js`
Expected: no output, exit code 0.

- [ ] **Step 5: Commit**

```bash
git add js/insumos.js
git commit -m "Inventario: editar nombre de insumos"
```

---

## Task 4: Verificación manual en Chrome

No hay tests automatizados en este proyecto (convención ya vigente) — esta es la verificación real.

- [ ] **Step 1: Levantar el server local y abrir la app**

Run: `npx serve .` (o `python -m http.server 8000`), abrir `http://localhost:PORT` en Chrome, iniciar sesión y entrar a una feria con al menos una categoría de precio, un combo y un insumo existentes.

- [ ] **Step 2: QA — Categorías**

Entrar a Inventario > Categorías de precio. Tocar "Nombre" en una categoría, cambiar el valor y guardar: confirmar que el nombre se actualiza en la lista. Cambiar el input de precio, confirmar que no hace falta tocar nada más para que guarde (dispara al salir del campo), recargar la página y confirmar que el nuevo precio persiste. Probar dejar el nombre vacío y confirmar el toast de error sin que se guarde.

- [ ] **Step 3: QA — Combos**

Entrar a Inventario > Combos. Repetir el mismo QA para nombre (botón + prompt), cantidad y precio (inputs inline). Confirmar que Pausar/Activar y Eliminar siguen funcionando exactamente igual que antes.

- [ ] **Step 4: QA — Insumos**

Entrar a Inventario > Insumos. Tocar "Nombre", cambiar el valor y guardar: confirmar que se refleja en la lista. Abrir el modal de insumos de un producto (Inventario > Productos > un producto > "Insumos") y confirmar que el nombre actualizado aparece ahí también (mismo `insumos` compartido).

- [ ] **Step 5: QA — regresión rápida en Productos**

Confirmar que editar nombre/descripción/stock/costo/precio individual/categoría de un producto sigue funcionando igual que antes de este cambio (no se tocó `filaProducto` ni `renderProductos`, pero vale confirmarlo tras tocar el resto del archivo).
