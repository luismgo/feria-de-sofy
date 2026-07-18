# Feria de Sofy — Submenús en Inventario, precio individual y densidad de grid en Vender

Fecha: 2026-07-17

## Resumen

Dos problemas de uso real durante la feria:

1. **Inventario está muy junto.** Hoy la pestaña apila 4 tarjetas (Categorías
   de precio, Combos, Productos, Insumos) en una sola pantalla larga.
   Productos ya tiene un acordeón por categoría de precio (agregado en un
   cambio anterior), pero no alcanza: sigue sintiéndose todo amontonado.
2. **Vender permite poner precio, y no debería.** Un producto sin categoría
   de precio ni precio propio muestra "Tocar para poner precio" en la
   grilla de venta, y abre un prompt que escribe `precio_override`
   directamente desde ahí. La mayoría de los precios se definen por
   categoría (no por producto), así que asignar precio es una tarea de
   gestión de catálogo, no algo que deba pasar a mitad de una venta.
3. **La grilla de Vender no da control de densidad.** `productos-grid` usa
   `auto-fill` con un mínimo fijo; según el ancho del teléfono a veces cae
   en 2 columnas cuando la usuaria preferiría ver más productos a la vez.

De paso, quitar "poner precio" de Vender deja un hueco: Inventario hoy no
tiene ningún campo para cargar el precio individual de un producto (solo se
elige la categoría). Sin cerrarlo, un producto en "Sin categoría" se
quedaría sin forma de tener precio nunca. Este spec cierra ese hueco como
parte del mismo cambio.

## Alcance

**Incluye:**
- **A** — Inventario: menú principal con 4 submenús (Categorías de precio,
  Combos, Productos, Insumos), cada uno como pantalla propia.
- **B** — Vender: quitar la posibilidad de asignar precio desde la grilla de
  venta; la tarjeta sin precio queda deshabilitada con aviso.
- **C** — Inventario: campo "Precio individual", visible solo cuando el
  producto está en "Sin categoría", que reemplaza la vía que se quita en B.
- **D** — Vender: switch Normal/Compacto para la densidad de la grilla de
  productos, persistido por dispositivo.

**No incluye (fuera de alcance):**
- Cambios al schema, a los RPC de dinero (`confirmar_venta`/`anular_venta`)
  o a la lógica de checkout.
- Un selector de columnas explícito (2/3/4) en el grid — se eligió un
  toggle simple de 2 estados.
- Permitir "precio individual" como excepción sobre una categoría ya
  asignada — se eligió que el campo solo aparezca en "Sin categoría".
- Tests automatizados (decisión YAGNI ya vigente en el proyecto;
  verificación manual en navegador).

## A — Inventario: menú con 4 submenús

`js/inventario.js` gana un estado local de vista (`'menu' | 'categorias' |
'productos' | 'combos' | 'insumos'`), reseteado a `'menu'` cada vez que se
entra a la pestaña (coherente con el comportamiento actual, que ya
re-fetchea todo al entrar — ver `nav.js: showTab`, que hace `clearTab` en
Inventario).

- **Vista menú** (default al entrar): lista de 4 filas estilo lista de
  ajustes iOS (coherente con el lenguaje de navegación ya adoptado en el
  rediseño de nav — ver `docs/superpowers/specs/2026-07-13-feria-nav-ios-redesign-design.md`),
  con ícono + label + conteo + `›`:
  - 🏷️ Categorías de precio — *N categorías*
  - 🎁 Combos — *N combos*
  - 📦 Productos — *N productos*
  - 🧵 Insumos — *N insumos*

  Los conteos se piden con queries livianas (`count: 'exact', head: true`),
  sin traer el detalle completo solo para mostrar un número. Filas con
  target ≥44px (regla de accesibilidad ya vigente en el proyecto).

- **Vista de detalle** (una por sección): header local `‹ Inventario`
  (mismo lenguaje visual que el back existente, pero local a esta pestaña —
  no toca el navbar global, que sigue siendo "volver a Ferias") + el
  contenido tal cual existe hoy para esa sección (formularios, listas; el
  acordeón por categoría de precio dentro de Productos se mantiene sin
  cambios). El FAB de "agregar producto" queda scoped solo a la vista de
  Productos. El header local es `sticky` arriba del scroll de la pestaña
  para no perder el back al bajar en listas largas.

Cambia solo `js/inventario.js` (reestructura `render`) + CSS nueva para el
menú y el header local (nuevas clases, ej. `.inv-menu`, `.inv-menu__item`,
`.inv-subview__header`). Cero cambios de schema/RPC.

## B — Vender: sin "poner precio"

En `js/vender.js`, la rama que hoy maneja `precio == null` (línea ~247)
deja de tener `addEventListener('click', ...)` y de llamar al
`promptDialog` / `update` sobre `feria_productos.precio_override`. La
tarjeta queda:
- `card.disabled = true` (mismo patrón que una tarjeta agotada).
- Texto cambiado de "Tocar para poner precio" a
  **"Sin precio — asignalo en Inventario"**.
- Conserva la clase `producto-card--sin-precio` para el estilo atenuado que
  ya existe.

Sin más cambios: sigue sin `data-categoria` (comentario existente en
`aplicarFiltroBusqueda`: las tarjetas sin categoría quedan siempre
visibles al filtrar por chip), así que el filtro de categoría se comporta
igual que hoy.

## C — Inventario: campo "Precio individual"

En `filaProducto` (`js/inventario.js`), un nuevo input numérico "Precio
individual $" junto a Stock/Costo (mismo patrón `inv-mini-label` +
listener `change` que valida ≥0 y hace `update` sobre
`feria_productos.precio_override`).

- **Visibilidad:** solo se muestra cuando `fp.categoria_precio_id` es nulo
  ("Sin categoría"). Si el producto tiene una categoría asignada, el campo
  no aparece — el precio lo da la categoría.
- **Valor inicial:** `precio_override ?? ''`.
- El listener que ya existe sobre `.inv-categoria-select` (que actualiza el
  badge de precio en el lugar sin re-render completo — ver
  `inventario.js:366-381`) se extiende para también mostrar/ocultar este
  input al cambiar entre categoría y "Sin categoría", sin recargar toda la
  fila.
- Vaciar el campo y disparar `change` guarda `precio_override = null`
  (vuelve a quedar "Sin precio" hasta que se cargue un valor o se asigne
  categoría) — es el único caso, junto a este input, donde vacío es válido;
  un valor negativo sigue rechazándose con un toast, igual que Stock/Costo.

## D — Vender: switch de densidad del grid

Botón de ícono en el header de Vender (junto al buscador), que alterna dos
clases sobre `.productos-grid`:

- **Normal** (default, comportamiento actual): `minmax(126px, 1fr)`.
- **Compacto**: mínimo más chico (ej. `minmax(90px, 1fr)`), con la foto y la
  tipografía de la tarjeta escaladas a juego para que no se vean apretadas.

Persistencia: `localStorage` con una clave global del dispositivo (no por
feria — es preferencia del teléfono, no de la venta puntual), leída al
entrar a Vender. Como `renderGrid` reconstruye la grilla en cada refresco
(realtime, agregar al carrito, etc.), la densidad guardada se reaplica en
cada reconstrucción a partir del valor en memoria/localStorage, así que no
se pierde con los refrescos.

Se suma un ícono nuevo al sprite SVG de `index.html` (mismo estilo lineal
que los íconos existentes: `i-vender`, `i-inventario`, etc.) para el botón
del switch.

## Archivos a tocar

- `js/inventario.js` — reestructura a menú + submenús (A), campo precio
  individual (C).
- `js/vender.js` — quitar click de "poner precio" (B), switch de densidad
  + persistencia en localStorage (D).
- `styles.css` — estilos del menú/submenú de Inventario, tarjeta
  deshabilitada sin precio (ajuste de texto, sin cambio de clase), clases
  de densidad del grid.
- `index.html` — nuevo ícono en el sprite SVG para el switch de densidad.

Sin cambios en `sql/`, `js/app.js`, ni en el contrato de los RPC.

## Decisiones tomadas

- Alcance de submenús: **menú principal con 4 submenús**, Productos
  conserva su acordeón por categoría tal cual (no se lo reemplaza por otro
  nivel de submenú).
- Producto sin precio en Vender: se **muestra deshabilitado con aviso**
  (no se oculta), para que se note el hueco durante la feria.
- Campo "Precio individual": **solo aparece en "Sin categoría"** (no como
  excepción siempre visible sobre una categoría ya asignada).
- Switch de grid: **toggle simple Normal/Compacto** (no selector explícito
  de columnas), y **se recuerda por dispositivo** vía localStorage.

## Verificación

Sin tests automatizados (ya es así en el proyecto). QA manual en navegador
(Claude-in-Chrome, viewport móvil y desktop):
- Inventario: entrar, ver el menú con los 4 conteos correctos, entrar a
  cada submenú y volver con `‹ Inventario`, confirmar que Productos
  conserva acordeón y FAB.
- Inventario/Productos: cambiar la categoría de un producto entre una
  categoría real y "Sin categoría" y verificar que el campo "Precio
  individual" aparece/desaparece y que el precio efectivo se actualiza.
- Vender: una tarjeta sin precio aparece deshabilitada con el aviso nuevo y
  no abre ningún diálogo al tocarla.
- Vender: el switch de densidad cambia la grilla, persiste tras recargar la
  página (mismo dispositivo) y se reaplica tras un refresco por realtime.
