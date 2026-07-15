# 🌸 Feria de Sofy

Tu puesto de feria, en el celular.

App web (PWA instalable) para que Sofy administre sus ferias: inventario, ventas en vivo con carrito, ideas y reportes — con sincronización en tiempo real entre varios celulares cobrando a la vez.

**En producción:** https://luismgo.github.io/feria-de-sofy/

## Qué hace

- **Vender** — grid de productos con foto, precio y stock disponible. Tap para armar un carrito por cliente (productos, combos o montos libres), con total corriendo. Al confirmar: método de pago con un tap (efectivo / transferencia / otro), descuento opcional, y confetti 🎉.
- **Checkout atómico** — la confirmación es una función de Postgres (`confirmar_venta`) que valida y descuenta stock de productos e insumos en una sola transacción. Si dos celulares compiten por el último producto, uno gana y el otro recibe un aviso claro; nunca quedan ventas a medias ni sobreventa.
- **Inventario compartido entre ferias** — los productos y los insumos (bolsitas, empaques) son un catálogo global: el mismo stock físico se lleva de una feria a otra sin duplicarse. Cada feria elige qué vende y a qué precio (por categoría de precio o precio individual).
- **Insumos con receta** — cada producto puede declarar qué insumos consume por unidad vendida; se descuentan solos al vender.
- **Combos** — por feria (ej. "3 stickers x $1000"), eligiendo los productos específicos en cada venta.
- **Anular venta** — RPC inversa (`anular_venta`) que repone stock en una transacción; soft-delete con motivo y auditoría, nunca DELETE.
- **Cerrar caja** — al final del día: efectivo esperado vs contado, totales por método de pago, ventas y anuladas.
- **Reportes** — por feria (por fecha con detalle de cada venta, productos más vendidos, desglose por categoría) y un reporte general comparando todas las ferias.
- **Ideas** — notas por feria (💡 producto / 📋 logística / 💰 precio-promo) con checkbox de hecho.
- **Tiempo real** — cambios de stock y ventas se reflejan en vivo en todos los dispositivos conectados (Supabase Realtime).

## Cómo está hecho

Sin framework y sin build step, a propósito:

- **Frontend:** HTML + CSS + JavaScript plano con módulos ES nativos (`index.html`, `styles.css`, `js/`). Confetti vía [canvas-confetti](https://github.com/catdad/canvas-confetti) por CDN.
- **Backend:** [Supabase](https://supabase.com) — Postgres + Realtime + Storage + Auth, accedido con `@supabase/supabase-js` por CDN. Toda la lógica del dinero vive en funciones de Postgres (`sql/`), no en el cliente.
- **PWA:** `manifest.json` + íconos; se instala a pantalla de inicio y abre standalone.
- **Hosting:** GitHub Pages, publicado desde `master`. Deploy = `git push`.

## Estructura

```
index.html              Shell de la app: login, selector de feria, tabs
styles.css              Todos los estilos
js/
  app.js                Punto de entrada y orquestación
  config.js             URL y publishable key de Supabase (públicas por diseño)
  supabaseClient.js     Cliente compartido
  auth.js               Login con link mágico
  ferias.js             Selector y creación de ferias
  vender.js             Grid de venta, carrito, confirmación
  inventario.js         Productos, categorías de precio, combos
  insumos.js            Catálogo de insumos y recetas
  ideas.js              Notas por feria
  reportes.js           Reportes por feria y cierre de caja
  reporte-general.js    Comparativa entre ferias
  nav.js / ui.js        Navegación, toasts, modales, helpers
  connection.js         Banner de sin conexión
sql/
  schema.sql            Schema completo (tablas + RLS)
  seed.sql              Ferias iniciales
  rpc_confirmar_venta.sql   Checkout atómico
  rpc_anular_venta.sql      Anulación con reposición de stock
  migrations/           Migraciones aditivas (correr una vez en el SQL Editor)
  tests/                Tests manuales de los RPCs (SQL Editor)
scripts/                Scripts de mantenimiento en Node (una sola vez / ocasionales)
docs/superpowers/       Specs y planes de diseño (v1, v2 "que la caja cuadre", rediseño de nav)
```

## Correr en local

No hay dependencias ni build: basta servir la carpeta como sitio estático.

```bash
npx serve .
# o
python -m http.server 8000
```

Abrí `http://localhost:8000` (o el puerto que indique `serve`). La app apunta al proyecto de Supabase configurado en `js/config.js`; para usar un proyecto propio, cambiá ahí la URL y la publishable key, y creá el schema con los archivos de `sql/` en este orden: `schema.sql` → `seed.sql` → `rpc_confirmar_venta.sql` → `rpc_anular_venta.sql` → migraciones de `sql/migrations/` por fecha.

## Acceso

Login con link mágico por correo (sin contraseña), restringido a una whitelist: en Supabase se deshabilita el registro público y solo entran correos invitados manualmente desde el dashboard (Authentication → Users → Invite user). La app pide el login con `shouldCreateUser: false`, así que un correo no invitado nunca puede entrar. Todas las tablas tienen RLS `to authenticated`.

## Scripts de mantenimiento

Corren en local con la service-role key (nunca en el cliente):

```bash
cd scripts && npm install
SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node import-stickers.mjs    # import inicial del inventario desde Excel
SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node comprimir-fotos.mjs    # recomprime fotos ya subidas al Storage
```

## Documentación de diseño

Las decisiones de producto y arquitectura están documentadas en `docs/superpowers/`:

- [`specs/2026-07-11-feria-de-sofy-design.md`](docs/superpowers/specs/2026-07-11-feria-de-sofy-design.md) — diseño de la v1: alcance, modelo de datos, pantallas, edge cases.
- [`specs/2026-07-11-feria-de-sofy-v2-definicion.md`](docs/superpowers/specs/2026-07-11-feria-de-sofy-v2-definicion.md) — la v2 "que la caja cuadre": método de pago, costos, descuentos, anulación y cierre de caja.
- [`specs/2026-07-13-feria-nav-ios-redesign-design.md`](docs/superpowers/specs/2026-07-13-feria-nav-ios-redesign-design.md) — rediseño de navegación estilo iOS.
