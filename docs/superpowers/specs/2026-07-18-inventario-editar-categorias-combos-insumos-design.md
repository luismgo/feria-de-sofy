# Feria de Sofy — Editar categorías, combos e insumos en Inventario

Fecha: 2026-07-18

## Resumen

No todos los elementos del catálogo son editables. Productos ya tiene edición
completa (nombre y descripción por botón+prompt, stock/costo/precio/categoría
como inputs inline que guardan al cambiar), pero:

- **Categorías de precio** (`renderCategorias`, `js/inventario.js`): solo
  tienen botón Eliminar. Para corregir un nombre o un precio mal cargado, hoy
  hay que borrar la categoría y crearla de nuevo — lo que además desvincula
  a todos los productos que la usaban.
- **Combos** (`renderCombos`, `js/inventario.js`): mismo problema. Solo
  Pausar/Activar y Eliminar; nombre, cantidad y precio no se pueden corregir
  sin recrear el combo.
- **Insumos** (`renderInsumosSection`, `js/insumos.js`): stock y costo ya son
  editables inline, pero el nombre no.

Este spec cierra el hueco en los tres, reusando el patrón que Productos ya
estableció — no hay que inventar UI nueva.

## Alcance

**Incluye:**
- **A** — Categorías de precio: nombre editable (botón + `promptDialog`),
  precio editable (input inline, guarda al cambiar).
- **B** — Combos: nombre editable (botón + `promptDialog`), cantidad y
  precio editables (inputs inline, guardan al cambiar).
- **C** — Insumos: nombre editable (botón + `promptDialog`).

**No incluye (fuera de alcance):**
- Cambios de schema, RPC, o al cálculo de precio efectivo
  (`precio_override` sobre categoría).
- Edición de Productos (nombre, descripción, stock, costo, precio, categoría)
  — ya está completo, no se toca.
- Nueva CSS: las clases que hacen falta (`.btn-accion`, `.btn-accion--peligro`,
  `.btn-accion--sm`, `.inv-mini-label`, `.row__actions`, ícono `#i-editar`) ya
  existen y ya se usan para este mismo propósito en Productos.

## A — Categorías de precio

En `renderCategorias` (`js/inventario.js`), cada fila pasa de un `<span>`
estático de solo lectura a:

- Nombre en su propio `<span>`.
- Input inline `.cat-precio-input` (numérico, `min="0" step="1"`) con
  listener `change` que valida ≥0 (mismo criterio que `.inv-costo-input`) y
  hace `update({ precio: val }).eq('id', ...)` sobre `categorias_precio`.
- Botón "Nombre" (ícono `#i-editar`) que abre `promptDialog` con el nombre
  actual, y al confirmar hace `update({ nombre })` — mismo patrón exacto que
  `editar-nombre` de productos (trim, rechaza vacío, no-op si no cambió).
- Botón Eliminar existente, sin cambios.

Como la vista de Categorías no muestra badges de precio de producto en la
misma pantalla, cualquiera de los dos guardados simplemente dispara
`render(feria, container)` para refrescar la fila — no hace falta
actualización "in place" como en Productos.

## B — Combos

En `renderCombos` (`js/inventario.js`), mismo tratamiento:

- Nombre: botón "Nombre" + `promptDialog` + `update({ nombre })`.
- Cantidad: input inline `.combo-cantidad-input` (`type="number" min="1"`),
  valida entero ≥1, `update({ cantidad: val })`.
- Precio: input inline `.combo-precio-input` (`min="0" step="1"`), valida
  ≥0, `update({ precio: val })`.
- Los botones Pausar/Activar y Eliminar existentes se mantienen sin cambios,
  agrupados junto al nuevo botón Nombre en `.row__actions`.

## C — Insumos

En `renderInsumosSection` (`js/insumos.js`), se agrega un botón "Nombre"
(mismo ícono/patrón) junto al botón Eliminar existente, que abre
`promptDialog` y hace `update({ nombre })` sobre `insumos`. Stock y costo no
cambian — ya son editables.

## Archivos a tocar

- `js/inventario.js` — edición de nombre/precio en Categorías (A), edición
  de nombre/cantidad/precio en Combos (B).
- `js/insumos.js` — edición de nombre en Insumos (C).

Sin cambios en `sql/`, `js/vender.js`, `js/app.js`, ni en el contrato de los
RPC. Sin CSS nueva.

## Decisiones tomadas

- Alcance: se cubren Categorías + Combos + Insumos en el mismo cambio (no
  solo Categorías), porque comparten el mismo defecto y el mismo arreglo.
- Patrón de edición: **el mismo mix que ya usa Productos** — campos
  numéricos como input inline que guarda al cambiar, nombre como botón que
  abre un `promptDialog`. Se descartó "todo inline" (menos consistente con
  cómo Productos ya edita su nombre) y "un modal por fila" (más clics para
  cambios chicos, y una UI nueva que el proyecto no tiene en ningún otro
  lado).

## Verificación

Sin tests automatizados (ya es así en el proyecto). QA manual en navegador:

- Inventario/Categorías: editar el nombre de una categoría (botón Nombre →
  prompt → guardar) y confirmar que se refleja en la lista. Cambiar el
  precio en el input inline y confirmar que guarda (recargar y verificar que
  persiste).
- Inventario/Combos: mismo QA para nombre, cantidad y precio. Confirmar que
  Pausar/Activar y Eliminar siguen funcionando igual que antes.
- Inventario/Insumos: editar el nombre de un insumo y confirmar que se
  refleja en la lista y en el selector de insumos de un producto
  (`abrirInsumosProducto`).
- Confirmar que valores inválidos (vacío o negativo en precio/cantidad)
  muestran el toast de error existente y no guardan.
