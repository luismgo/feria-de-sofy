# Feria de Sofy — Diseño

## Resumen

App web para que Sofy organice inventario, ventas en vivo e ideas para sus
ferias. Arranca con 2:

1. **Stickers y Accesorios** 🎨
2. **Comida y Postres** 🧁

...pero se pueden crear más ferias con el tiempo. Cada feria tiene su propia
configuración de precios, combos, notas y reportes, pero los **productos y
los insumos (empaques/materiales) son un catálogo compartido**: el mismo
stock físico se lleva de una feria a otra, no se duplica. Se vende en vivo
desde el celular durante el evento, armando un carrito por cliente (puede
comprar varias cosas distintas) con sincronización en tiempo real entre
varios dispositivos (ej. Sofy y quien la ayude cobrando en paralelo). Hay un
espacio de notas para ideas de producto, logística y precios/promos, y
reportes claros por feria y generales. Acceso restringido a una lista
cerrada de correos vía inicio de sesión con link mágico (Supabase Auth).

## Alcance

**Incluye:**
- Selector de feria, con posibilidad de **crear más ferias** con el tiempo
- Catálogo de **productos compartido** entre ferias (mismo nombre/foto/stock
  físico); cada feria elige cuáles vende y a qué precio ahí
- Catálogo de **insumos compartido** (empaques/materiales que no se venden
  directo, ej. bolsitas): cada producto puede tener una "receta" de qué
  insumos consume por unidad vendida; se descuentan solos al vender
- Categorías de precio por feria (ej. Chico/Mediano/Grande)
- Combos predefinidos por feria (ej. "3 stickers x $1000"), reutilizables en
  cualquier venta de esa feria
- **Carrito de venta**: se van agregando productos y/o combos a un carrito
  (una persona puede llevarse varias cosas distintas), se ve el total
  corriendo, y recién al confirmar se descuenta stock (de productos e
  insumos) y se registra la venta — o se puede vaciar el carrito sin dejar
  rastro si no se concreta
- Animación de confetti al confirmar una venta
- Reportes por feria (total vendido, cantidad de ventas, productos más
  vendidos, desglose por categoría de precio) y un **reporte general**
  comparando todas las ferias
- Notas/ideas por feria, categorizadas (producto / logística / precio-promo),
  con checkbox de "hecho"
- Login con link mágico por correo (Supabase Auth), restringido a una
  whitelist de correos invitados manualmente
- Import inicial (una vez, vía script) del inventario real de stickers ya
  existente (53 diseños con foto, nombre y cantidad) desde
  `insumos/Inventario stickers.xlsx`

**No incluye (fuera de alcance, YAGNI):**
- Roles o permisos diferenciados entre usuarios invitados (todo usuario
  autenticado tiene acceso completo a todas las ferias, no hay distinción
  admin/colaborador)
- Interfaz para gestionar la whitelist (invitar/quitar correos se hace desde
  el dashboard de Supabase, no desde la app)
- Modo offline-first completo (se asume wifi/datos disponibles en las ferias)
- Tests automatizados
- Historial/auditoría de carritos abandonados (si no se confirma la venta,
  no queda ningún registro — no hay "ventas canceladas" guardadas)
- Alertas de stock bajo o mínimos configurables
- Asignación automática de categoría de precio a partir de las medidas en cm
  del import — se asigna a mano después de importar

## Arquitectura

- **Frontend**: HTML + CSS + JS plano (módulos ES nativos, sin build step,
  sin framework). Archivos: `index.html`, `styles.css`, `app.js` + módulos en
  `js/`.
- **Backend**: Supabase (proyecto nuevo, separado de otros proyectos del
  usuario) — Postgres + Realtime, accedido vía `@supabase/supabase-js` por
  CDN.
- **Confirmación de venta**: función de Postgres (`rpc`) que recibe el
  carrito completo y hace *todo* en una sola transacción — valida y descuenta
  stock de productos e insumos, inserta la venta y sus líneas. Si algo no
  alcanza, la transacción entera se revierte sola y no se guarda nada
  parcial. Se eligió una función de base de datos en vez de varias llamadas
  seguidas desde el cliente porque el carrito ahora puede tocar múltiples
  tablas (productos, insumos, combos) a la vez, y solo Postgres puede
  garantizar que todo eso pase junto o no pase nada.
- **Confetti**: librería `canvas-confetti` vía CDN (sin dependencias, no
  rompe el "sin build step").
- **Hosting**: GitHub Pages, deploy vía `git push` a la rama de Pages.
- **Autenticación**: Supabase Auth con link mágico por correo (passwordless).
  La sesión la persiste automáticamente el cliente de `supabase-js`.

### Por qué Supabase sobre alternativas

Se evaluaron Firebase (Firestore), Supabase y Google Sheets como backend.
Firebase habría sido la opción por defecto para sincronización en tiempo real
sin cuenta previa, pero el usuario ya tiene una cuenta/proyecto Supabase en
uso (`finanzas-pwa`) y prefiere mantener el ecosistema. Google Sheets se
descartó por no ofrecer tiempo real confiable y por riesgo de conflictos de
escritura cuando dos personas venden simultáneamente.

Se decidió un **proyecto Supabase nuevo y separado** (no reutilizar el de
`finanzas-pwa`) para mantener los datos de la feria completamente aislados de
las finanzas personales del usuario.

### Autenticación y whitelist

Se usa Supabase Auth con **link mágico por correo** (`signInWithOtp`, sin
contraseña).

La whitelist se logra sin tabla propia, con configuración de Supabase:

1. En el dashboard, **Authentication → deshabilitar "Allow new users to
   sign up"** (nadie se puede registrar solo).
2. **Invitar manualmente** el correo de Sofy (y de quien la ayude) desde
   Authentication → Users → Invite user. Solo esos correos existen como
   usuarios.
3. El login se pide con `signInWithOtp({ email, options: { shouldCreateUser:
   false } })` — con signups deshabilitados y `shouldCreateUser: false`, un
   correo no invitado nunca puede entrar.
4. Row Level Security en todas las tablas usa políticas `to authenticated`:
   solo alguien con sesión iniciada puede leer o escribir datos.

Agregar o quitar gente de la whitelist es una acción manual en el dashboard
de Supabase, no algo que la app exponga en su interfaz.

## Modelo de datos (tablas Supabase / Postgres)

```
ferias
  id            uuid (pk)
  nombre        text            -- "Stickers y Accesorios"
  emoji         text            -- "🎨"
  slug          text (unique)

categorias_precio
  id            uuid (pk)
  feria_id      uuid (fk -> ferias.id)
  nombre        text            -- "Chico" / "Mediano" / "Grande"
  precio        numeric
  orden         integer

productos                          -- catálogo GLOBAL, compartido entre ferias
  id            uuid (pk)
  nombre        text
  imagen_url    text (nullable)    -- Supabase Storage
  stock         integer            -- stock físico real, compartido
  created_at    timestamptz

feria_productos                    -- qué productos vende cada feria, y a qué precio ahí
  id                    uuid (pk)
  feria_id              uuid (fk -> ferias.id)
  producto_id           uuid (fk -> productos.id)
  categoria_precio_id   uuid (fk -> categorias_precio.id, nullable)
  precio_override       numeric (nullable)  -- gana sobre la categoría si está seteado
  unique (feria_id, producto_id)

insumos                            -- catálogo GLOBAL de empaques/materiales, no se venden directo
  id            uuid (pk)
  nombre        text               -- "Bolsita transparente"
  stock         integer
  created_at    timestamptz

producto_insumos                   -- receta: qué insumos consume 1 unidad de un producto
  id            uuid (pk)
  producto_id   uuid (fk -> productos.id)
  insumo_id     uuid (fk -> insumos.id)
  cantidad      integer            -- unidades de insumo por unidad de producto vendida
  unique (producto_id, insumo_id)

combos
  id            uuid (pk)
  feria_id      uuid (fk -> ferias.id)
  nombre        text               -- "Combo 3 stickers"
  cantidad      integer            -- cuántos productos entran en el combo
  precio        numeric
  activo        boolean default true

ventas                             -- una venta = un carrito confirmado
  id            uuid (pk)
  feria_id      uuid (fk -> ferias.id)
  total         numeric            -- suma de sus venta_items
  created_at    timestamptz

venta_items                        -- líneas del carrito
  id                        uuid (pk)
  venta_id                  uuid (fk -> ventas.id)
  tipo                      text   -- 'producto' | 'combo'
  producto_id               uuid (fk -> productos.id, nullable)
  combo_id                  uuid (fk -> combos.id, nullable)
  producto_nombre           text   -- snapshot: nombre del producto o del combo
  categoria_precio_nombre   text (nullable)  -- snapshot, solo tipo='producto'
  cantidad                  integer default 1
  precio_unitario           numeric  -- precio de 1 unidad, o del combo completo

venta_item_combo_productos         -- detalle: qué productos específicos entraron en una línea de combo
  id              uuid (pk)
  venta_item_id   uuid (fk -> venta_items.id)
  producto_id     uuid (fk -> productos.id, nullable)
  producto_nombre text          -- snapshot

notas
  id            uuid (pk)
  feria_id      uuid (fk -> ferias.id)
  tipo          text            -- 'producto' | 'logistica' | 'precio'
  texto         text
  hecho         boolean default false
  created_at    timestamptz
```

No hay tabla propia para autenticación/whitelist — la maneja Supabase Auth.

**Precio efectivo** de un producto dentro de una feria = `precio_override` de
su fila en `feria_productos` si está seteado, si no el `precio` de la
`categoria_precio` elegida ahí. El mismo producto puede tener precio distinto
en cada feria donde se vende (vía su propia fila en `feria_productos`),
aunque comparta el mismo stock físico.

**Total de una venta** = suma de `precio_unitario * cantidad` de todos sus
`venta_items`. Para una línea de combo, `cantidad` siempre es 1 y
`precio_unitario` es el precio fijo del combo — el ingreso del combo no se
reparte entre los productos que lo componen, pero `venta_item_combo_productos`
sí registra cuáles fueron para poder descontar su stock (y el de sus
insumos) y para el reporte de "productos más vendidos".

## Pantallas y flujo

1. **Login** — pantalla rosa de bienvenida con input de correo. Al enviar,
   pide un link mágico vía `supabase.auth.signInWithOtp`. Si el correo está
   invitado, llega un mail con el link; al clickearlo, vuelve a la app ya
   con sesión iniciada. Si no está invitado, no puede entrar. La sesión
   persiste sola entre visitas.

2. **Selector de feria** — una tarjeta grande por feria existente, más una
   tarjeta "+ Nueva feria" (nombre + emoji) para crear otra con el tiempo.
   Accesible en cualquier momento vía botón "cambiar feria". También tiene un
   link a **Reporte general** (comparativa entre todas las ferias).

3. **Vista de feria**, con navegación por pestañas (mobile-first, tabs abajo):

   - **Vender** (pestaña default) — grid de tarjetas por producto vinculado a
     esta feria (foto, nombre, precio efectivo acá, stock restante), más una
     fila de botones de combo activos arriba. Tap en un producto o combo →
     se agrega a un **carrito** visible (no se toca la base de datos
     todavía); tocar de nuevo un producto ya en el carrito suma cantidad; un
     combo abre el selector para elegir los N productos específicos
     incluidos. El carrito muestra cada línea con su subtotal y el **total**
     corriendo, respetando el stock disponible menos lo que ya está en el
     carrito (para no dejar vender de más entre dos personas armando
     carritos distintos al mismo tiempo). Dos acciones:
     - **Confirmar venta** → llama a la función de base de datos que
       descuenta stock de productos e insumos y registra la venta, todo en
       una transacción. Si todo sale bien: confetti 🎉, toast de éxito, se
       vacía el carrito. Si algo ya no tiene stock (alguien más lo vendió
       mientras se armaba el carrito), se avisa cuál ítem falló sin tocar el
       resto, para ajustarlo y reintentar.
     - **Vaciar carrito** → lo descarta sin guardar nada.
     Cambios de stock se reflejan en vivo en todos los dispositivos
     conectados vía Supabase Realtime.

   - **Inventario** — con sub-secciones:
     - *Categorías de precio* y *Combos* de esta feria (crear/editar/desactivar)
     - *Productos*: agregar producto nuevo (nombre, foto, categoría de
       precio de esta feria, stock inicial) — o **"Reutilizar producto de
       otra feria"**: elegís una feria existente, ves sus productos, y
       vinculás los que quieras a esta feria (con su propia categoría de
       precio acá) sin duplicar el producto ni su stock. Cada producto se
       puede editar (foto, stock, categoría/precio acá) o eliminarse solo de
       esta feria (sigue existiendo si otra feria lo usa) o por completo.
       Desde la edición de un producto también se arma su **receta de
       insumos** (qué insumos consume y cuántos por unidad vendida).
     - *Insumos*: catálogo de empaques/materiales (nombre, stock) —
       agregar/reponer/eliminar. No aparecen en la pantalla de Vender.

   - **Ideas** — lista de notas con selector de tipo (💡 producto / 📋
     logística / 💰 precio-promo), texto libre, checkbox "hecho". Filtrable
     por tipo.

   - **Reportes** — de esta feria: total vendido y cantidad de ventas por
     fecha ("hoy" destacado arriba, fechas pasadas debajo), productos más
     vendidos (ranking), y desglose de lo vendido por categoría de precio
     (los combos se agrupan aparte, ya que no pertenecen a una sola
     categoría).

4. **Reporte general** (fuera de una feria en particular, accedido desde el
   selector) — comparativa lado a lado de cuánto vendió cada feria (total y
   cantidad de ventas) más el total combinado de todas.

## Diseño visual

- Paleta: rosa dulce/pastel (ej. `#FF8FB1` de acento, `#FFD6E8` de fondo) +
  blanco, bordes muy redondeados, sombras suaves.
- Tipografía redondeada/amigable (ej. Google Font "Quicksand" o "Baloo 2").
- Emojis como iconografía (🎨 🧁 💡 📋 💰 ✅ 🛒) en vez de set de íconos.
- Confetti al confirmar una venta (breve, no bloqueante).
- Mobile-first (uso principal: celular en la feria), pero responsive para
  editar inventario cómodamente desde una compu en casa.

## Manejo de errores y edge cases

- **Sin stock**: producto/combo no se puede agregar al carrito más allá de
  lo disponible (considerando lo que ya está en el carrito).
- **Condición de carrera al confirmar** (dos carritos en dispositivos
  distintos compiten por el mismo último producto o insumo): la función de
  base de datos valida y descuenta todo en una transacción; si algo ya no
  alcanza, esa venta entera no se escribe y se informa cuál ítem falló, sin
  dejar registros parciales.
- **Insumo insuficiente**: si un producto tiene receta de insumos y alguno
  no alcanza (ej. no quedan bolsitas), la venta de ese producto falla igual
  que si faltara stock del producto mismo — se avisa cuál insumo faltó.
- **Sin conexión**: banner visible de "sin conexión", la pestaña "Vender" no
  deja confirmar carritos hasta reconectar (evita ventas fantasma).
- **Correo no invitado**: `signInWithOtp` devuelve error y la app lo muestra
  como mensaje simple.
- **Producto o insumo eliminado con ventas previas**: `venta_items` y
  `venta_item_combo_productos` conservan su propio nombre (snapshot), así
  que los reportes se mantienen íntegros aunque el producto ya no exista.
- **Combo sin suficientes productos disponibles**: si al elegir los N
  productos de un combo no hay suficientes con stock, el selector lo indica
  y no permite confirmar hasta completar la cantidad requerida.
- **Eliminar un producto compartido entre ferias**: "quitar de esta feria"
  solo borra el vínculo en `feria_productos` (el producto sigue existiendo
  para las demás); "eliminar por completo" borra el producto de raíz y de
  todas las ferias que lo usaban — se pide confirmación explícita.

## Import inicial de inventario existente

`insumos/Inventario stickers.xlsx` (no versionado en git, ver `.gitignore`)
tiene el inventario real y actual de 53 diseños de sticker: nombre, cantidad
(stock) y foto embebida por fila (no tiene precio ni categoría). Se escribe
un script de import de una sola vez (Node, usando `@supabase/supabase-js`
con la service-role key, corrido localmente y no incluido en el bundle del
cliente) que:

1. Lee el `.xlsx` con `exceljs` y extrae nombre + cantidad por fila
2. Extrae las imágenes embebidas del `.xlsx` (es un `.zip`, imágenes en
   `xl/media/`) y las sube a Supabase Storage
3. Crea un `producto` global por diseño (`stock` = cantidad de la hoja,
   `imagen_url` apuntando a la imagen subida) y lo vincula a la feria
   "Stickers y Accesorios" vía `feria_productos`, **sin** categoría de
   precio asignada todavía (se asigna a mano después desde Inventario, ya
   que la hoja solo trae medidas en cm, no categoría)

La feria de comida/postres arranca vacía — su inventario (productos e
insumos) se carga a mano desde la app.

## Testing

Sin tests automatizados — fuera de alcance dado el tamaño del proyecto
(decisión YAGNI explícita, a diferencia de otros proyectos del usuario con
Playwright). Verificación manual antes de dar por terminada la
implementación: ejercitar el flujo completo (crear producto con receta de
insumos → armar un carrito con varios productos y un combo → confirmar la
venta → confirmar que bajó el stock de productos e insumos, que aparece en
el reporte, y que la sincronización en tiempo real funciona con dos
pestañas/dispositivos abiertos a la vez → reutilizar ese producto en otra
feria y confirmar que comparte el mismo stock).
