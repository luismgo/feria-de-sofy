# Feria de Sofy — Inventario: editar, buscar, ordenar y alta en popup

Fecha: 2026-07-18

> **Reemplaza** a `2026-07-18-inventario-editar-categorias-combos-insumos-design.md`
> (mismo día, mismo alcance de edición) — ese spec queda como registro histórico,
> pero el plan de implementación de esta fecha es el vigente: dobla la edición de
> campos con buscador/orden/popup porque tocan exactamente las mismas funciones
> de render y conviene resolverlas en una sola pasada por sección.

## Resumen

Dos problemas de uso real en Inventario, atacados juntos porque tocan el mismo
código:

1. **No todo el catálogo es editable.** Categorías de precio y Combos solo
   tienen botón Eliminar — corregir un nombre o un precio mal cargado obliga a
   borrar y recrear (y en categorías, desvincula productos). Insumos edita
   stock/costo pero no nombre. Productos ya tiene edición completa; es el
   modelo a seguir.
2. **Las listas no se pueden buscar ni ordenar, y el alta est á al final.** Con
   más de un puñado de items, encontrar uno para editarlo implica scrollear
   toda la lista. El formulario de alta vive abajo de todo, colapsado detrás de
   un botón "Agregar...". Productos además fuerza un agrupamiento fijo por
   categoría (acordeón) que no siempre es el criterio que se busca.

## Alcance

**Incluye — por sección (Categorías, Combos, Productos, Insumos):**
- **A — Edición de campos:** nombre (botón "Nombre" + `promptDialog`, patrón
  ya usado en Productos), y los campos numéricos propios de cada sección como
  input inline que guarda al cambiar (precio en Categorías; cantidad y precio
  en Combos; stock y costo ya editables en Insumos, sin cambios ahí).
- **B — Buscador:** input de texto que filtra en vivo por nombre (substring,
  case-insensitive), sin re-fetch.
- **C — Orden:** un `<select>` con criterios por sección (ver tabla abajo).
  Todo criterio no alfabético usa nombre A-Z como desempate.
- **D — Alta en popup:** el botón "Agregar..." abre un modal (`abrirModal`,
  mismo helper que ya usan "Traer de otra feria" e "Insumos de producto") en
  vez de desplegar un formulario inline. Vive en una barra de herramientas
  fija arriba de la lista (buscador + select de orden + botón Agregar), ya no
  al final.
- **E — Productos: sin acordeón.** Se quita el agrupamiento colapsable
  (`<details>`) por categoría. "Categoría" pasa a ser un criterio de orden más:
  al elegirlo, se muestran subtítulos de categoría fijos (no colapsables) con
  los productos en A-Z dentro de cada uno; con cualquier otro orden, lista
  plana sin subtítulos. El FAB de "Agregar producto" se elimina — ya no hace
  falta, el botón queda siempre visible en la barra de herramientas.

**Criterios de orden por sección:**

| Sección    | Opciones (default: Nombre A-Z)              |
|------------|----------------------------------------------|
| Categorías | Nombre · Precio                               |
| Combos     | Nombre · Precio · Cantidad                    |
| Productos  | Nombre · Categoría · Precio · Stock           |
| Insumos    | Nombre · Stock · Costo                        |

**No incluye (fuera de alcance):**
- Cambios de schema, RPC, o al cálculo de precio efectivo.
- Re-fetch al buscar/ordenar — todo opera sobre el array ya cargado en
  memoria (mismo enfoque que el buscador de Vender).
- Re-ordenar/re-agrupar en vivo cuando se cambia la categoría de un producto
  desde su propio selector inline — ese cambio sigue actualizando el badge de
  precio en el lugar (como hoy) sin recalcular la posición del item en la
  lista; para verla reflejada alcanza con tocar buscar/ordenar de nuevo o
  reentrar a la sección.
- El menú principal de Inventario (4 filas con conteo) — sin cambios.
- "Traer de otra feria" — sigue siendo su propio modal, sin cambios.

## Arquitectura

**Helpers compartidos nuevos en `js/ui.js`:**
```js
// Filtra por substring de nombre, case-insensitive. Sin query, devuelve todo.
export function filtrarPorNombre(items, query, getNombre) { ... }

// Ordena por un criterio; sin extractor (alfabético) u ordenando por un valor
// numérico con nombre como desempate. `criterios` mapea value del <select> a
// una función que extrae el valor a comparar (undefined = solo alfabético).
export function ordenar(items, criterio, criterios, getNombre) { ... }
```
Se usan igual en las 4 secciones — evita repetir la misma lógica de
filtro/orden cuatro veces.

**Patrón por sección (Categorías, Combos, Insumos — Productos es un caso
especial por el modo "Categoría", ver más abajo):**
- La vista guarda el array completo ya fetcheado (`categorias`, `combos`,
  `insumos`) en el closure de la función de subvista, igual que hoy.
- El input de búsqueda y el `<select>` de orden dispraan un recálculo
  (`filtrarPorNombre` → `ordenar`) y vuelven a llamar a la función de
  renderizado de lista existente (`renderCategorias`, `renderCombos`, el
  render de insumos), que reemplaza sólo el contenedor de la lista
  (`#inv-categorias`, etc.) — el buscador y el select viven afuera de ese
  contenedor, así que no pierden foco al tipear (mismo truco que
  `aplicarFiltroBusqueda` en Vender).
- El botón "Agregar..." pasa de `bindToggleForm` a abrir un modal con
  `abrirModal`, con el mismo formulario y misma lógica de guardado que hoy
  tenía el form inline; al guardar, `cerrar(true)` + `render(feria, container)`.

**Caso especial — Productos:**
- Se extrae un helper `precioEfectivo(fp, categorias)` (hoy la lógica está
  inline en `filaProducto`) para reusarlo también como criterio de orden por
  precio. Productos sin precio (`null`) se ordenan al final en el criterio
  "Precio" (no rompen el orden ascendente de los que sí tienen).
- Con orden = "Categoría": agrupa (categorías en su `orden`, "Sin categoría"
  al final) con un subtítulo fijo `<p>` (no `<details>/<summary>`) por grupo,
  productos en A-Z dentro. Con cualquier otro orden: lista plana con
  `ordenar()`.
- El FAB (`#inv-fab-producto`, `bindFab`) se elimina junto con `bindToggleForm`
  para el form de productos — el botón "Agregar producto" y "Traer de otra
  feria" quedan juntos en la barra de herramientas, siempre visibles.

## Archivos a tocar

- `js/ui.js` — agrega `filtrarPorNombre` y `ordenar`.
- `js/inventario.js` — reescribe `renderCategoriasVista`, `renderCombosVista`,
  `renderProductosVista`, `renderCategorias`, `renderCombos`, `renderProductos`,
  `filaProducto` (nuevo `precioEfectivo`); quita `bindToggleForm`, `bindFab`.
- `js/insumos.js` — reescribe `renderInsumosSection` (buscador, orden, modal,
  edición de nombre).
- `styles.css` — nuevas clases para la barra de herramientas (buscador +
  select + botón) y el subtítulo fijo de categoría en Productos; reusa
  `.input`, `.btn-accion`, `.modal`/`.modal-actions`/`.form-alta` existentes.

Sin cambios en `sql/`, `js/app.js`, `js/vender.js`, ni en el contrato de los
RPC.

## Decisiones tomadas

- Alcance de edición: Categorías + Combos + Insumos, mismo mix que ya usa
  Productos (inline para números, botón+prompt para nombre).
- Buscador y orden en las 4 secciones (no solo Productos/Insumos).
- Alta en popup (no formulario inline colapsado) — consistente en las 4
  secciones.
- Productos pierde el acordeón fijo; "Categoría" se vuelve un modo de orden
  entre otros, con subtítulos no colapsables en vez de `<details>`.
- No se re-ordena en vivo al cambiar la categoría de un producto desde su
  select inline — es un caso raro (recién asignás/reasignás categoría) y
  forzarlo agregaría complejidad para un beneficio marginal.

## Verificación

Sin tests automatizados (convención ya vigente). QA manual en navegador:

- Cada sección: editar nombre (botón+prompt) y el/los campo(s) numérico(s)
  inline; confirmar que persisten tras recargar. Confirmar validación
  (nombre vacío, número negativo) con el toast existente.
- Cada sección: escribir en el buscador y confirmar que la lista filtra en
  vivo sin perder foco del input. Cambiar el `<select>` de orden y confirmar
  el orden resultante (incluir el caso "Sin precio" al final en Precio de
  Productos).
- Cada sección: tocar "Agregar...", confirmar que abre un modal, cargar y
  guardar; confirmar que la lista se actualiza y el modal se cierra.
  Confirmar que Escape y tocar el fondo cancelan sin guardar.
- Productos: cambiar el orden a "Categoría" y confirmar subtítulos fijos
  (sin flecha de colapsar) con productos A-Z dentro; cambiar a otro orden y
  confirmar que los subtítulos desaparecen. Confirmar que ya no hay FAB y
  que "Agregar producto"/"Traer de otra feria" están arriba, siempre
  visibles.
