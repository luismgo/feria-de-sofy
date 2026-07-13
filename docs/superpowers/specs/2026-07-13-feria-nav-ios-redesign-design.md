# Feria de Sofy — Rediseño de navegación mobile-first estilo iOS

Fecha: 2026-07-13 · Rama: `feat/nav-ios-redesign` · Prototipo aprobado:
artifact `89f595d8-2608-4a9b-996a-5dd5820d8016`

## Resumen

La navegación actual de `feria-view` mezcla dos patrones que se sienten
incoherentes entre sí: un link subrayado `← Cambiar feria` (`.btn-link`) y
unas pestañas-tarjeta arriba (`.tabs` / `.tab-btn`). Sofy usa la app en el
celular, de pie, durante la feria. Este rediseño adopta el **lenguaje de
navegación de iOS** —barra superior con back `‹ Ferias` + **tab bar
inferior** bajo el pulgar— **conservando la identidad cálida** (Quicksand,
durazno/terracota, radios 16px) y **todo lo ganado en accesibilidad**
(contraste AA, targets 44px, acciones con etiqueta visible).

De paso, y porque caen en la misma zona de código (el render del carrito y
los estilos), se cierran tres ítems de backlog: el **bug de foco** del input
de descuento (B) y tres **cosméticos** (C1 borde fuera de paleta, C2 markup
duplicado, C3 separador de miles).

Principio heredado a respetar: **no se toca el RPC del dinero**
(`confirmar_venta`/`anular_venta`). Este rediseño cambia *dónde y cómo se
dibuja* el carrito, nunca la llamada al RPC ni su contrato de 5 argumentos.

## Alcance

**Incluye (esta rama):**
- **A — Rediseño de navegación iOS**
  - Nav bar superior de 3 columnas (`[‹ Ferias | título | slot]`) en
    `feria-view` y `reporte-general`, reemplazando los `.btn-link`
    subrayados. La lógica de "volver" ya existe y no cambia.
  - Tab bar inferior fija con las 4 secciones (Vender/Inventario/Ideas/
    Reportes), reutilizando `showTab()` como única fuente de verdad.
  - Carrito de Vender reconvertido a **mini-dock + hoja (Opción C)** para
    convivir con la tab bar sin colisión.
  - Safe-area iOS (`viewport-fit=cover` + `env(safe-area-inset-*)`),
    escala de z-index explícita, contenedor de scroll único con `100dvh`.
- **B — Bug de foco**: preservar el foco/caret del input de descuento ante
  un re-render disparado por realtime.
- **C1** — reemplazar el borde `#DDE3F5` (azul-lila, fuera de paleta) por el
  token cálido `--border: #D9A97E`, promovido a custom property en `:root`.
- **C2** — desduplicar el markup img+nombre de la tarjeta de producto.
- **C3** — separador de miles en los 2 call sites que faltan
  (`inventario.js:163,182`) vía el `formatMoney()` existente.

**No incluye (fuera de alcance, otra sesión):**
- **D — v3**: `escapeHtml` en interpolaciones de `producto_nombre` (XSS),
  cola offline + PWA instalable, reporte de márgenes (costo).
- **E — Operativo**: autorizar `dalmenene@gmail.com` en Supabase Auth.
- Cambios al RPC del dinero, al schema o a la lógica de checkout.
- Tests automatizados (decisión YAGNI del proyecto; verificación manual).

## La colisión central y su resolución

Una tab bar inferior fija (`bottom:0`) **choca de frente** con el
`.carrito-panel` de Vender, que hoy también es `position:fixed; bottom:0;
max-height:40vh` y **no declara `z-index`** (gana solo por ser el último nodo
del DOM — frágil). Son los dos únicos elementos anclados al borde inferior en
móvil. Además `.productos-grid` reserva hueco solo para el carrito
(`margin-bottom: calc(40vh + 16px)`), no para una tab bar.

**Resolución elegida — Opción C (mini-dock + hoja):**
- **Estado colapsado — mini-dock** (`#carrito-dock`): franja compacta
  (~52px) "🛒 3 · $3.500 · Cobrar", anclada *justo encima* de la tab bar
  (`bottom: calc(var(--tabbar-h) + var(--safe-bottom))`), `z-index:25`
  (sobre el contenido, bajo la tab bar). Solo visible en la pestaña Vender.
- **Estado expandido — hoja** (`.carrito-sheet`): el carrito completo
  (líneas, descuento, método de pago, Vaciar/Confirmar) sube como panel
  `max-height:70dvh; overflow-y:auto`, `z-index:40` (por encima de la tab
  bar), con un backdrop (`z-index:39`) que atenúa la tab bar → foco total al
  cobrar y evita cambios de sección accidentales a mitad de venta.
- **Reserva de espacio**: se elimina el hack `margin-bottom: calc(40vh +
  16px)` de `.productos-grid`; el respiro inferior lo da
  `padding-bottom`/`scroll-padding-bottom` en el contenedor de scroll, que
  reserva `tabbar + dock + safe-area` en Vender y solo `tabbar + safe-area`
  en las otras 3 secciones (vía `feria-view[data-tab]`).

Descartada la Opción A (carrito apilado permanente): dos barras fijas roban
demasiado alto vertical en teléfonos chicos y dejan poca grilla visible.

## Arquitectura

Sin cambios de stack: HTML + CSS + ES modules, sin build. Archivos a tocar:
`index.html`, `styles.css`, `js/nav.js`, `js/vender.js`,
`js/reporte-general.js`, `js/inventario.js`, `js/ui.js` (token/locale). Sin
tocar SQL, `js/app.js` (firmas intactas), ni el contrato con el RPC.

### HTML (`index.html`)

- `<meta name="viewport" content="width=device-width, initial-scale=1,
  viewport-fit=cover, interactive-widget=resizes-content">` (hoy falta
  `viewport-fit=cover`; sin él las `env(safe-area-*)` valen 0).
- `feria-view` pasa a shell de columna: `.navbar` (sticky) + `.feria-scroll`
  (único contenedor scrolleable que envuelve los 4 `.tab-panel`) +
  `#carrito-dock` + `.carrito-sheet`/`.carrito-backdrop` (inyectados/toggle) +
  `<nav class="tabbar">`. Atributo `data-tab` en `feria-view` para disparar
  el padding correcto del scroll.
- Nav bar: `<button class="navbar__back" id="btn-cambiar-feria"
  aria-label="Volver a la lista de ferias"><span aria-hidden="true">‹</span>
  Ferias</button>` + `<h1 class="navbar__title" id="feria-titulo">` +
  `<span class="navbar__trailing">` (slot simétrico para centrar el título).
- Tab bar: `<nav aria-label="Secciones de la feria">` con 4 `<button
  class="tabbar__item" data-tab="...">` que llevan `<span class="tabbar__icon"
  aria-hidden="true">` (emoji) + `<span class="tabbar__label">` (texto
  visible). El activo marca `aria-current="page"`. **NO** se usa el patrón
  ARIA `role="tablist"` (implica navegación por flechas y expectativas de AT
  que no queremos); navegación semántica con `<nav>` + `aria-current`.
- `reporte-general`: misma `.navbar` con back `‹ Ferias` (o `‹ Volver`).
- `#connection-banner`: se decide anclarlo junto a la zona fija superior para
  que su aparición/desaparición no empuje la nav bar (hoy está en flujo y
  causaría saltos de layout con una barra superior fija/sticky).

### CSS (`styles.css`)

- Tokens nuevos en `:root`: `--navbar-h`, `--tabbar-h`, `--dock-h`,
  `--safe-top: env(safe-area-inset-top,0px)`,
  `--safe-bottom: env(safe-area-inset-bottom,0px)`, y **`--border:#D9A97E`**
  (promoviendo el borde cálido de facto; migrar los ~7 literales y sacar el
  `#DDE3F5`).
- Shell: `body{overflow:hidden}` + `feria-view` como `flex-column;
  height:100dvh`; `.feria-scroll{flex:1; min-height:0; overflow-y:auto;
  overscroll-behavior:contain}`. `100dvh` (no `100vh`) y `min-height:0` en el
  hijo flex evitan el bug de la barra de URL de iOS y el desbordamiento.
- `.navbar`: `position:sticky; top:0; z-index:30; display:grid;
  grid-template-columns:1fr auto 1fr`; fondo `color-mix(in srgb, var(--bg)
  82%, transparent)` + `backdrop-filter: saturate(1.4) blur(14px)` (con
  `-webkit-` y `@supports not` de fallback sólido); `padding-top:
  var(--safe-top)`.
- `.tabbar`: `position:fixed; bottom:0; z-index:30; display:flex`;
  `padding-bottom: max(var(--safe-bottom), 8px)`; fondo translúcido cálido +
  blur con fallback. Ítem activo: `color: var(--accent-strong)` + pastilla
  `background: color-mix(in srgb, var(--accent) 16%, transparent)` + peso 700
  (activo comunicado por color **y** forma, no solo color).
- `.carrito-dock` (z25), `.carrito-sheet` (z40), `.carrito-backdrop` (z39),
  con `border-radius: var(--radius) var(--radius) 0 0` y sombra cálida
  (`0 -4px 12px rgba(224,112,63,.18)` / sheet más profunda). Animación de
  subida de la hoja bajo `@media (prefers-reduced-motion: no-preference)`.
- `.toast`: subir su `bottom` por encima de tab bar (+ dock en Vender);
  mantener `z-index:200`.
- Foco visible: `:focus-visible{ outline:2px solid var(--accent-strong);
  outline-offset:2px }` en back, tab items y controles del carrito (hoy no
  hay foco visible).
- Breakpoint `≥700px`: `feria-view{max-width:700px; margin:0 auto}`; la tab
  bar se centra a 700px. Se elimina el `margin-bottom: calc(40vh+16px)` de
  `.productos-grid`.

### JS

- **`js/nav.js` — `showTab(tab)`** (fuente de verdad única, no duplicar
  estado):
  - `document.getElementById('feria-view').dataset.tab = tab` (dispara el
    padding correcto del scroll).
  - `#carrito-dock.hidden = (tab !== 'vender')`.
  - Togglear `.is-active` + `aria-current="page"` en `.tabbar__item`
    (reemplaza el selector `.tab-btn` del binding actual; actualizar el guard
    `tabButtonsBound`).
  - Preservar la asimetría existente: Reportes se re-fetchea al entrar
    (`clearTab`), las otras tabs se cachean vía `currentCleanups`.
  - `btn-cambiar-feria` (ahora `.navbar__back`) mantiene su handler → limpia
    tabs, oculta la vista, `onExit()`.
- **`js/vender.js` — carrito dock + hoja + fix de foco (B)**:
  - `renderCarrito` pasa a pintar el **mini-dock** (resumen "🛒 N · $total")
    siempre que haya ítems, y la **hoja** solo cuando está expandida.
    Abrir/cerrar la hoja: `Cobrar`/backdrop/`Escape`, con `aria-modal`-like
    (mover foco al abrir, devolverlo al cerrar).
  - **Fix de foco (B)**: la causa raíz es que el callback realtime
    (`vender.js:32-37`) llama a `loadAndRender` → `render` → `container.
    innerHTML=''` (`vender.js:87`), que destruye el input de descuento
    (`#input-descuento`) mientras Sofy tipea. Fix recomendado: antes de
    reconstruir, si `document.activeElement` es el input de descuento (o el
    buscador), preservar `value` + caret y re-enfocar tras reconstruir (con
    `try/catch` para `setSelectionRange` en `type=number`); o, alternativa
    más conservadora, posponer el `loadAndRender` mientras ese input tenga
    foco. Ninguna toca el RPC.
  - **C2**: extraer el markup común img+nombre (`vender.js:131-159`) a
    constantes `media`/`nombre` antes del `if`; cada rama arma solo su parte
    variable (poner-precio vs precio+stock), preservando los dos handlers de
    click distintos.
- **`js/reporte-general.js`**: `btn-volver-selector` adopta el markup/clase
  de `.navbar__back`; handler intacto.
- **`js/inventario.js` (C3)**: migrar `inventario.js:163` y `182` de
  `$${c.precio}` a `${formatMoney(c.precio)}` (quitando el `$` literal, que
  `formatMoney` ya incluye). Resto del archivo ya usa `formatMoney`.
- **`js/ui.js`**: `formatMoney` ya existe (`'$' + Number(n||0).
  toLocaleString('es-MX')`). Decisión pendiente menor de locale (ver Preguntas
  abiertas). Sin cambios de firma.

## Escala de z-index (explícita)

De menor a mayor: `contenido (auto)` → `carrito-dock (25)` → `navbar /
tabbar (30)` → `carrito-backdrop (39)` → `carrito-sheet (40)` →
`modal-overlay (100)` → `toast (200)`. El dock queda en 25 (bajo la tab bar
en 30) **a propósito**: no se solapan porque el dock se ancla *encima* de la
tab bar (`bottom: calc(var(--tabbar-h) + var(--safe-bottom))`), así que el
orden de pila entre ellos es indistinto en la práctica. Reglas duras: la tab
bar **debe** quedar por debajo de `modal-overlay (100)` para que los
modales/pickers la tapen; el `.carrito-sheet` **debe** quedar por encima de
la tab bar (40 > 30) o el CTA "Confirmar venta" quedaría debajo y no
recibiría taps.

## Identidad cálida (no volverlo gris iOS)

Esqueleto iOS, piel Feria de Sofy: barras translúcidas sobre `--bg` durazno
(no `rgba(255,255,255,.7)` frío); ítem activo en `--accent-strong` con
pastilla terracota; Quicksand en labels (700 activo / 600 inactivo); emoji a
color como íconos (🛒📦💡📊); radios 16px arriba en dock/hoja; sombras con
tinte terracota; hairlines `rgba(92,58,38,.12)` (marrón, no gris); back y CTA
"Cobrar" en terracota.

## Accesibilidad (preservar lo ganado)

- Semántica: `<nav aria-label>` + `<button aria-current="page">` (no
  `role="tablist"`). Ícono `aria-hidden` + label de texto **visible** en cada
  tab (regla "acción con etiqueta visible").
- Targets: `.tabbar__item{min-height:44px}`, back y controles del carrito
  ≥44px.
- Contraste AA: label inactivo en `var(--text)` (#5C3A26, alto contraste) a
  peso 600 — **no** bajar por opacidad; activo en `--accent-strong` (~5:1
  validado). Verificar el label sobre el vidrio translúcido, no sobre blanco
  puro.
- `:focus-visible` en todos los controles nuevos.
- Estado activo por color **+** peso **+** pastilla (daltonismo).
- `prefers-reduced-motion: reduce` desactiva la animación de la hoja.
- La hoja: foco al primer control al abrir, `Escape` cierra, foco devuelto al
  dock al cerrar.

## Edge cases y pitfalls

1. **100vh en iOS** → usar `100dvh` + shell flex con `min-height:0` en el
   hijo scroll.
2. **Teclado que tapa inputs** (Inventario/precio/descuento): iOS Safari no
   redimensiona el viewport; mitigar con `interactive-widget=resizes-content`
   y ocultar tab bar + dock mientras un input tiene foco
   (`focusin`/`focusout`) + `scrollIntoView({block:'center'})`. En la hoja,
   que scrollee la propia hoja.
3. **Doble scroll**: `body{overflow:hidden}` + un único `.feria-scroll` con
   `overscroll-behavior:contain`.
4. **Containing block por transform**: ningún ancestro de tabbar/dock/sheet
   puede tener `transform`/`filter`/`backdrop-filter` (reancla el `fixed`).
   Cuidado con `.toast` (usa `transform`): mantenerlo hermano, no padre.
5. **backdrop-filter**: requiere `-webkit-` + `@supports not (...)` con fondo
   sólido de fallback (si no, barra transparente y texto ilegible).
6. **safe-area sin `viewport-fit=cover`**: `env()` = 0 → error nº1, ya
   cubierto en el meta.
7. **No duplicar `safe-area-bottom`** en scroll-region y tabbar a la vez.
8. **Borrar** el `margin-bottom: calc(40vh+16px)` de `.productos-grid` o el
   hueco se duplica.

## Verificación

Sin tests automatizados (YAGNI del proyecto). **QA visual en navegador real
es obligatoria antes de dar por terminada la UI** (requisito del proyecto):
Claude-in-Chrome sobre `http://localhost:8000`, viewport móvil (375px) y
desktop. Peor caso a verificar: iPhone 375px con **carrito lleno + banner
offline visible simultáneamente** (banner + nav superior + grilla + dock +
tab bar). Checklist:
- Nav bar: back `‹ Ferias` sale del feria-view y del reporte-general; título
  centrado y truncado con nombres largos.
- Tab bar: las 4 secciones cambian; Inventario/Ideas/Reportes usan todo el
  alto (sin dock); estado activo legible (color + peso + pastilla).
- Carrito: dock visible solo en Vender con ítems; `Cobrar` abre la hoja;
  backdrop atenúa la tab bar; `Confirmar`/`Vaciar` funcionan; el CTA no queda
  bajo la tab bar.
- **Bug de foco (B)**: tipear en el input de descuento y simular un evento
  realtime (o segundo dispositivo) — el foco/caret **no** se pierde.
- Contraste AA en labels; foco visible con teclado.
- Sin doble scroll; sin salto de layout al aparecer/desaparecer el banner.
- Montos con separador de miles en Inventario (categorías y combos).

## Decisiones tomadas (defaults, el usuario puede revertir)

- **Locale de `formatMoney`**: se **mantiene `'es-MX'`** (ya agrega miles con
  coma: `$1,234`). El ítem C3 es solo "que haya separador", y `es-MX` ya lo
  da; cambiar a `'es-AR'` (`$1.234`) es un cambio app-wide fuera del alcance
  de C3. Revertir es un one-liner en `ui.js` si se prefiere formato argentino.
- **`#connection-banner`**: se **ancla dentro de la zona fija superior**
  (junto a la nav bar) para que su aparición/desaparición no empuje el layout
  ni cause saltos con la barra superior fija.
