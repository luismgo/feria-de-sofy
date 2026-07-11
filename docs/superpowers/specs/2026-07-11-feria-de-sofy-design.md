# Feria de Sofy — Diseño

## Resumen

App web para que Sofy organice inventario, ventas en vivo e ideas para 2 ferias
recurrentes:

1. **Stickers y Accesorios** 🎨
2. **Comida y Postres** 🧁

Cada feria tiene su propio inventario, se puede vender en vivo desde el celular
durante el evento con sincronización en tiempo real entre varios dispositivos
(ej. Sofy y quien la ayude cobrando en paralelo), y hay un espacio de notas
para ideas de producto, logística y precios/promos. Acceso restringido a una
lista cerrada de correos (Sofy y quien la ayude) vía inicio de sesión con
link mágico por correo (Supabase Auth).

## Alcance

**Incluye:**
- Selector de feria (2 ferias, cada una con su propio inventario/ventas/notas)
- Inventario editable por feria (agregar, editar, reponer stock, eliminar
  producto), con foto real por producto
- Categorías de precio por feria (ej. Chico/Mediano/Grande), para no tener
  que fijar precio producto por producto
- Combos (ej. "3 stickers x $1000"): al vender, se eligen los productos
  específicos incluidos y se descuenta el stock de cada uno
- Venta en vivo: tocar producto o combo → resta stock → registra venta con
  detalle (qué se vendió, precio, hora) → sincroniza en todos los
  dispositivos conectados
- Historial de ventas agrupado por fecha (total vendido, # de ventas, "hoy" destacado)
- Notas/ideas por feria, categorizadas (producto / logística / precio-promo),
  con checkbox de "hecho"
- Login con link mágico por correo (Supabase Auth), restringido a una
  whitelist de correos invitados manualmente
- Import inicial (una vez, vía script) del inventario real de stickers ya
  existente (53 diseños con foto, nombre y cantidad) desde
  `insumos/Inventario stickers.xlsx`

**No incluye (fuera de alcance, YAGNI):**
- Roles o permisos diferenciados entre usuarios invitados (todo usuario
  autenticado tiene acceso completo a ambas ferias, no hay distinción
  admin/colaborador)
- Interfaz para gestionar la whitelist (invitar/quitar correos se hace desde
  el dashboard de Supabase, no desde la app)
- Modo offline-first completo (se asume wifi/datos disponibles en ambas ferias)
- Tests automatizados
- Variantes de un mismo producto por talla/color/sabor dentro de un solo
  registro (cada tamaño/diseño distinto es su propio producto, agrupado por
  categoría de precio en vez de por "variante")
- Reportes/analítica avanzada más allá del historial por fecha
- Asignación automática de categoría de precio a partir de las medidas en cm
  del import — se asigna a mano después de importar

## Arquitectura

- **Frontend**: HTML + CSS + JS plano (módulos ES nativos, sin build step,
  sin framework). Archivos: `index.html`, `styles.css`, `app.js`.
- **Backend**: Supabase (proyecto nuevo, separado de otros proyectos del
  usuario) — Postgres + Realtime, accedido vía `@supabase/supabase-js` por CDN.
- **Hosting**: GitHub Pages, deploy vía `git push` a la rama de Pages.
- **Autenticación**: Supabase Auth con link mágico por correo (passwordless).
  La sesión la persiste automáticamente el cliente de `supabase-js` (no hace
  falta manejar `localStorage` a mano).

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
contraseña) en vez del PIN considerado originalmente — es una barrera real a
nivel de base de datos, no solo de interfaz, y no cuesta más esfuerzo de
implementar.

La whitelist se logra sin tabla propia, con configuración de Supabase:

1. En el dashboard, **Authentication → deshabilitar "Allow new users to
   sign up"** (nadie se puede registrar solo).
2. **Invitar manualmente** el correo de Sofy (y de quien la ayude) desde
   Authentication → Users → Invite user. Solo esos correos existen como
   usuarios.
3. El login se pide con `signInWithOtp({ email, options: { shouldCreateUser:
   false } })` — con signups deshabilitados y `shouldCreateUser: false`, un
   correo no invitado nunca puede entrar, invitado o no.
4. Row Level Security en todas las tablas usa políticas `to authenticated`
   (en vez de abiertas a la anon key): solo alguien con sesión iniciada
   (correo invitado que ya clickeó su link mágico) puede leer o escribir
   datos. Esto cierra a nivel de red el hueco que un PIN puramente de
   interfaz habría dejado abierto.

Agregar o quitar gente de la whitelist es una acción manual en el dashboard
de Supabase (invitar / eliminar usuario), no algo que la app exponga en su
interfaz — no hace falta para 1-2 personas.

## Modelo de datos (tablas Supabase / Postgres)

```
ferias
  id            uuid (pk)
  nombre        text            -- "Stickers y Accesorios"
  emoji         text            -- "🎨"
  slug          text (unique)   -- "stickers"

categorias_precio
  id            uuid (pk)
  feria_id      uuid (fk -> ferias.id)
  nombre        text            -- "Chico" / "Mediano" / "Grande"
  precio        numeric
  orden         integer         -- para mostrarlas siempre en el mismo orden

productos
  id                    uuid (pk)
  feria_id              uuid (fk -> ferias.id)
  nombre                text
  categoria_precio_id   uuid (fk -> categorias_precio.id, nullable)
  precio_override       numeric (nullable)  -- si está seteado, gana sobre la categoría
  stock                 integer
  imagen_url            text (nullable)     -- Supabase Storage
  created_at            timestamptz

combos
  id            uuid (pk)
  feria_id      uuid (fk -> ferias.id)
  nombre        text            -- "Combo 3 stickers"
  cantidad      integer         -- cuántos productos entran en el combo
  precio        numeric
  activo        boolean default true

ventas
  id            uuid (pk)
  feria_id      uuid (fk -> ferias.id)
  tipo          text            -- 'individual' | 'combo'
  combo_id      uuid (fk -> combos.id, nullable)
  nombre        text            -- snapshot: nombre del producto o del combo
  precio        numeric         -- snapshot: precio cobrado
  created_at    timestamptz

venta_items
  id                uuid (pk)
  venta_id          uuid (fk -> ventas.id)
  producto_id       uuid (fk -> productos.id, nullable on delete set null)
  producto_nombre   text        -- snapshot al momento de la venta
  created_at        timestamptz

notas
  id            uuid (pk)
  feria_id      uuid (fk -> ferias.id)
  tipo          text            -- 'producto' | 'logistica' | 'precio'
  texto         text
  hecho         boolean default false
  created_at    timestamptz
```

No hay tabla propia para autenticación/whitelist — la maneja Supabase Auth
(usuarios invitados manualmente, ver sección de Autenticación arriba).

Precio efectivo de un producto = `precio_override` si está seteado, si no el
`precio` de su `categorias_precio`. La mayoría de los productos solo usan la
categoría; `precio_override` es la salida de escape para el caso raro de un
precio individual distinto.

Una venta **individual** genera 1 fila en `ventas` (`tipo='individual'`) + 1
fila en `venta_items`. Una venta de **combo** genera 1 fila en `ventas`
(`tipo='combo'`, precio = precio del combo) + una fila en `venta_items` por
cada producto específico elegido (para descontar el stock exacto de cada
uno). El total vendido de un combo no se reparte entre sus productos — se
contabiliza como un solo monto en el historial.

Las "sesiones por día" (para el historial) no son una tabla aparte: se derivan
agrupando `ventas` por `created_at::date`. Esto evita tener que "cerrar caja"
manualmente — cada fecha nueva es automáticamente una sesión distinta en el
historial, y el inventario (`productos.stock`) persiste entre ferias como
corresponde a un stock real que se repone.

## Pantallas y flujo

1. **Login** — pantalla rosa de bienvenida con input de correo. Al enviar,
   pide un link mágico vía `supabase.auth.signInWithOtp`. Si el correo está
   invitado, llega un mail con el link; al clickearlo, vuelve a la app ya
   con sesión iniciada (el cliente de `supabase-js` detecta la sesión de la
   URL de redirección automáticamente). Si no está invitado, no puede
   entrar. La sesión persiste sola entre visitas — no hay que loguearse cada
   vez.
2. **Selector de feria** — dos tarjetas grandes (una por feria) para elegir en
   cuál trabajar. Accesible en cualquier momento vía botón "cambiar feria".
3. **Vista de feria**, con navegación por pestañas (mobile-first, tabs abajo):
   - **Vender** (pestaña default) — grid de tarjetas grandes por producto
     (foto, nombre, precio efectivo, stock restante), más una fila de botones
     de combo activos arriba. Tap en un producto → confirma venta → `UPDATE
     productos SET stock = stock - 1 WHERE id = ? AND stock > 0` (evita
     stock negativo en condición de carrera) → si tuvo efecto, inserta filas
     en `ventas`/`venta_items`. Tap en un combo → abre selector para elegir
     los N productos específicos incluidos (respetando su stock disponible)
     → confirma → descuenta stock de cada uno elegido y registra la venta
     del combo. Cambios de stock se reflejan en vivo en todos los
     dispositivos conectados vía Supabase Realtime. Producto con stock 0 →
     no seleccionable.
   - **Inventario** — lista editable: agregar producto nuevo (nombre, foto,
     categoría de precio, stock inicial), editar categoría/precio override,
     reponer/ajustar stock, eliminar producto. Sección aparte para gestionar
     categorías de precio y combos de la feria (crear/editar/desactivar).
   - **Ideas** — lista de notas con selector de tipo (💡 producto / 📋
     logística / 💰 precio-promo), texto libre, checkbox "hecho". Filtrable
     por tipo.
   - **Historial** — resumen agrupado por fecha: total vendido ($) y # de
     ventas por día (individuales y combos contabilizados juntos). "Hoy"
     destacado arriba; fechas pasadas debajo (colapsable).

## Diseño visual

- Paleta: rosa dulce/pastel (ej. `#FF8FB1` de acento, `#FFD6E8` de fondo) +
  blanco, bordes muy redondeados, sombras suaves.
- Tipografía redondeada/amigable (ej. Google Font "Quicksand" o "Baloo 2").
- Emojis como iconografía (🎨 🧁 💡 📋 💰 ✅) en vez de set de íconos.
- Mobile-first (uso principal: celular en la feria), pero responsive para
  editar inventario cómodamente desde una compu en casa.

## Manejo de errores y edge cases

- **Sin stock**: botón de "vender" deshabilitado, sin necesidad de mensaje de error.
- **Condición de carrera** (dos dispositivos venden el último producto casi
  simultáneamente): el `UPDATE ... WHERE stock > 0` solo tiene efecto para
  una de las dos escrituras; la otra ve que no afectó filas y muestra "ya no
  queda stock" sin insertar la venta.
- **Sin conexión**: banner visible de "sin conexión", pestaña "Vender" se
  deshabilita temporalmente para evitar ventas que no lleguen a guardarse
  (ventas fantasma). Se reactiva automáticamente al reconectar.
- **Correo no invitado**: `signInWithOtp` devuelve error (con signups
  deshabilitados y `shouldCreateUser: false`) y la app lo muestra como
  mensaje simple, sin revelar si el correo existe o no como norma general de
  buena práctica, aunque para 1-2 usuarios esto no es crítico.
- **Producto eliminado con ventas previas**: las filas de `ventas` y
  `venta_items` conservan su propio `nombre`/`producto_nombre` y `precio`
  (snapshot), así que el historial se mantiene íntegro aunque el producto ya
  no exista en `productos`.
- **Combo sin suficiente stock**: si al elegir los productos de un combo no
  hay suficientes con stock disponible, el selector lo indica y no permite
  confirmar hasta que se complete la cantidad requerida.

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
3. Crea un `producto` por diseño en la feria "Stickers y Accesorios" con
   `stock` = cantidad de la hoja, `imagen_url` apuntando a la imagen subida,
   y **sin** categoría de precio asignada (se asigna a mano después desde la
   pantalla de Inventario, ya que la hoja solo trae medidas en cm, no
   categoría)

La feria de comida/postres arranca vacía — su inventario se carga a mano
desde la app.

## Testing

Sin tests automatizados — fuera de alcance dado el tamaño del proyecto
(decisión YAGNI explícita, a diferencia de otros proyectos del usuario con
Playwright). Verificación manual antes de dar por terminada la
implementación: ejercitar el flujo completo (agregar producto → vender →
confirmar que baja el stock y aparece en historial → editar inventario →
agregar nota) con dos pestañas/dispositivos abiertos a la vez para confirmar
que la sincronización en tiempo real funciona como se espera.
