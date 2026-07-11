# Feria de Sofy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a mobile-first web app for Sofy to manage a shared product/insumo catalog across multiple recurring fairs, sell via a cart with atomic checkout, and see reports — backed by Supabase (Postgres + Realtime + Auth + Storage), no build step, hosted on GitHub Pages.

**Architecture:** Vanilla HTML/CSS/JS (ES modules, no bundler) talking directly to Supabase via `@supabase/supabase-js` (CDN). Cart checkout goes through a single Postgres RPC function that does all stock validation/decrement + inserts in one transaction. Auth is Supabase magic-link, restricted to manually-invited emails. Realtime subscriptions keep multiple devices in sync.

**Tech Stack:** HTML5, CSS3, JavaScript (ES2022 modules), Supabase JS client v2 (CDN, `https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm`), Supabase (Postgres/Auth/Storage/Realtime), canvas-confetti (CDN), Node.js + exceljs (one-time import script only), GitHub Pages.

## Global Constraints

- No build step: plain ES modules loaded via `<script type="module">`, no bundler, no framework. All CDN imports use `+esm` jsDelivr URLs.
- No automated test framework (explicit YAGNI decision in the spec) — every task ends with a manual verification procedure (exact clicks/inputs and exact expected result) instead of unit tests.
- Local dev server required for ES modules (they fail over `file://`): every verification step assumes `python -m http.server 8000` is running from the project root and the app is opened at `http://localhost:8000`.
- Color palette: `#FF8FB1` accent, `#FFD6E8` background, white. Rounded corners, soft shadows. Font: Google Font "Quicksand".
- Products (`productos`) and packaging materials (`insumos`) are a **shared catalog** across all fairs — stock lives on them directly, not per-fair. Fairs opt into selling a product via `feria_productos` (which also holds the fair-specific price).
- Every stock-affecting write must be race-condition-safe (`UPDATE ... WHERE stock >= N`), because multiple devices write concurrently.
- Cart confirmation is atomic: implemented as ONE Postgres RPC call (`confirmar_venta`), never as sequential client-side writes.
- RLS is enabled on every table with policies scoped `to authenticated` — there is no anonymous read/write path.
- `insumos/` (the source spreadsheet) is already gitignored — never read/write it from the shipped app, only from the one-time import script.
- Repo root is `C:\Users\luis\Desktop\Sofi Feria` (already a git repo with the design spec committed at `docs/superpowers/specs/2026-07-11-feria-de-sofy-design.md` — read it before starting if you need the full rationale behind any decision below).

---

### Task 1: Proyecto Supabase — schema, RLS, storage, seed

**Files:**
- Create: `sql/schema.sql`
- Create: `sql/seed.sql`

**Interfaces:**
- Produces: 11 tables (`ferias`, `categorias_precio`, `productos`, `feria_productos`, `insumos`, `producto_insumos`, `combos`, `ventas`, `venta_items`, `venta_item_combo_productos`, `notas`), all RLS-enabled with `to authenticated` policies; storage bucket `productos-fotos` (public); 2 seed rows in `ferias`.

This task requires manual action in the Supabase dashboard — no subagent can complete it alone without the user's Supabase account. If you're executing this as an agent, stop and ask the user to do steps 1-3 themselves (or drive the Supabase dashboard via browser automation only if the user explicitly asks for that), then continue once they confirm.

- [ ] **Step 1: Crear el proyecto Supabase**

Ir a https://supabase.com/dashboard → New Project → nombre "feria-de-sofy" (o el que se prefiera) → elegir región cercana → crear. Esperar a que termine de aprovisionar (~2 min).

- [ ] **Step 2: Guardar URL y anon key**

En el dashboard del proyecto: Settings → API. Copiar **Project URL** y **anon public key** — se necesitan en la Tarea 3. Copiar también la **service_role key** (Settings → API → "service_role secret") y guardarla aparte (NO en git) — se necesita en la Tarea 17 para el script de import.

- [ ] **Step 3: Escribir `sql/schema.sql`**

```sql
create extension if not exists "pgcrypto";

create table ferias (
  id uuid primary key default gen_random_uuid(),
  nombre text not null,
  emoji text not null,
  slug text not null unique
);

create table categorias_precio (
  id uuid primary key default gen_random_uuid(),
  feria_id uuid not null references ferias(id) on delete cascade,
  nombre text not null,
  precio numeric not null,
  orden integer not null default 0
);

create table productos (
  id uuid primary key default gen_random_uuid(),
  nombre text not null,
  imagen_url text,
  stock integer not null default 0,
  created_at timestamptz not null default now()
);

create table feria_productos (
  id uuid primary key default gen_random_uuid(),
  feria_id uuid not null references ferias(id) on delete cascade,
  producto_id uuid not null references productos(id) on delete cascade,
  categoria_precio_id uuid references categorias_precio(id) on delete set null,
  precio_override numeric,
  unique (feria_id, producto_id)
);

create table insumos (
  id uuid primary key default gen_random_uuid(),
  nombre text not null,
  stock integer not null default 0,
  created_at timestamptz not null default now()
);

create table producto_insumos (
  id uuid primary key default gen_random_uuid(),
  producto_id uuid not null references productos(id) on delete cascade,
  insumo_id uuid not null references insumos(id) on delete cascade,
  cantidad integer not null default 1,
  unique (producto_id, insumo_id)
);

create table combos (
  id uuid primary key default gen_random_uuid(),
  feria_id uuid not null references ferias(id) on delete cascade,
  nombre text not null,
  cantidad integer not null,
  precio numeric not null,
  activo boolean not null default true
);

create table ventas (
  id uuid primary key default gen_random_uuid(),
  feria_id uuid not null references ferias(id) on delete cascade,
  total numeric not null,
  created_at timestamptz not null default now()
);

create table venta_items (
  id uuid primary key default gen_random_uuid(),
  venta_id uuid not null references ventas(id) on delete cascade,
  tipo text not null check (tipo in ('producto', 'combo')),
  producto_id uuid references productos(id) on delete set null,
  combo_id uuid references combos(id) on delete set null,
  producto_nombre text not null,
  categoria_precio_nombre text,
  cantidad integer not null default 1,
  precio_unitario numeric not null,
  created_at timestamptz not null default now()
);

create table venta_item_combo_productos (
  id uuid primary key default gen_random_uuid(),
  venta_item_id uuid not null references venta_items(id) on delete cascade,
  producto_id uuid references productos(id) on delete set null,
  producto_nombre text not null
);

create table notas (
  id uuid primary key default gen_random_uuid(),
  feria_id uuid not null references ferias(id) on delete cascade,
  tipo text not null check (tipo in ('producto', 'logistica', 'precio')),
  texto text not null,
  hecho boolean not null default false,
  created_at timestamptz not null default now()
);

alter table ferias enable row level security;
alter table categorias_precio enable row level security;
alter table productos enable row level security;
alter table feria_productos enable row level security;
alter table insumos enable row level security;
alter table producto_insumos enable row level security;
alter table combos enable row level security;
alter table ventas enable row level security;
alter table venta_items enable row level security;
alter table venta_item_combo_productos enable row level security;
alter table notas enable row level security;

create policy "authenticated full access" on ferias for all to authenticated using (true) with check (true);
create policy "authenticated full access" on categorias_precio for all to authenticated using (true) with check (true);
create policy "authenticated full access" on productos for all to authenticated using (true) with check (true);
create policy "authenticated full access" on feria_productos for all to authenticated using (true) with check (true);
create policy "authenticated full access" on insumos for all to authenticated using (true) with check (true);
create policy "authenticated full access" on producto_insumos for all to authenticated using (true) with check (true);
create policy "authenticated full access" on combos for all to authenticated using (true) with check (true);
create policy "authenticated full access" on ventas for all to authenticated using (true) with check (true);
create policy "authenticated full access" on venta_items for all to authenticated using (true) with check (true);
create policy "authenticated full access" on venta_item_combo_productos for all to authenticated using (true) with check (true);
create policy "authenticated full access" on notas for all to authenticated using (true) with check (true);

alter publication supabase_realtime add table productos;
alter publication supabase_realtime add table ventas;

insert into storage.buckets (id, name, public) values ('productos-fotos', 'productos-fotos', true)
on conflict (id) do nothing;

create policy "authenticated upload productos-fotos" on storage.objects for insert to authenticated with check (bucket_id = 'productos-fotos');
create policy "authenticated update productos-fotos" on storage.objects for update to authenticated using (bucket_id = 'productos-fotos');
```

Pegar y correr este SQL completo en el dashboard de Supabase → SQL Editor → New query → Run.

- [ ] **Step 4: Escribir y correr `sql/seed.sql`**

```sql
insert into ferias (nombre, emoji, slug) values
  ('Stickers y Accesorios', '🎨', 'stickers'),
  ('Comida y Postres', '🧁', 'comida');
```

Correr en el mismo SQL Editor.

- [ ] **Step 5: Deshabilitar signups públicos**

Dashboard → Authentication → Sign In / Providers (o "Auth Settings" según la versión) → desactivar **"Allow new users to sign up"**. Guardar.

- [ ] **Step 6: Invitar a Sofy (y quien la ayude)**

Dashboard → Authentication → Users → **Invite user** → ingresar el correo de Sofy. Repetir para cualquier otro correo que necesite acceso. Cada invitado recibe un correo con un link — no hace falta que lo clickeen todavía, solo que la cuenta quede creada (así `shouldCreateUser: false` los reconoce más adelante).

- [ ] **Step 7: Configurar Redirect URLs**

Dashboard → Authentication → URL Configuration → agregar a **Redirect URLs**: `http://localhost:8000` (para desarrollo local). Se agregará la URL de producción de GitHub Pages en la Tarea 18.

- [ ] **Step 8: Verificación manual**

En el SQL Editor, correr `select nombre, emoji from ferias;` → debe devolver las 2 filas sembradas. Correr `select count(*) from storage.buckets where id = 'productos-fotos';` → debe devolver 1.

- [ ] **Step 9: Commit**

```bash
git add sql/schema.sql sql/seed.sql
git commit -m "Add Supabase schema, RLS policies, and seed fairs"
```

---

### Task 2: Función RPC `confirmar_venta` (checkout atómico)

**Files:**
- Create: `sql/rpc_confirmar_venta.sql`

**Interfaces:**
- Consumes: tablas creadas en Tarea 1.
- Produces: función Postgres `confirmar_venta(p_feria_id uuid, p_items jsonb) returns table(venta_id uuid, total numeric)`, invocable desde el cliente como `supabase.rpc('confirmar_venta', { p_feria_id, p_items })`. `p_items` es un array JSON de líneas:
  - producto: `{"tipo":"producto","producto_id":"<uuid>","cantidad":2}`
  - combo: `{"tipo":"combo","combo_id":"<uuid>","producto_ids":["<uuid>","<uuid>","<uuid>"]}`
  Lanza una excepción (mensaje legible) y revierte todo si algún producto/insumo no tiene stock suficiente.

- [ ] **Step 1: Escribir `sql/rpc_confirmar_venta.sql`**

```sql
create or replace function confirmar_venta(p_feria_id uuid, p_items jsonb)
returns table (venta_id uuid, total numeric)
language plpgsql
as $$
declare
  v_venta_id uuid := gen_random_uuid();
  v_total numeric := 0;
  v_item jsonb;
  v_producto record;
  v_categoria_nombre text;
  v_precio numeric;
  v_venta_item_id uuid;
  v_combo record;
  v_producto_id_text text;
  v_insumo record;
  v_cantidad integer;
begin
  insert into ventas (id, feria_id, total) values (v_venta_id, p_feria_id, 0);

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    if v_item->>'tipo' = 'producto' then
      v_cantidad := (v_item->>'cantidad')::integer;

      select p.id, p.nombre, fp.categoria_precio_id, fp.precio_override
        into v_producto
        from productos p
        join feria_productos fp on fp.producto_id = p.id and fp.feria_id = p_feria_id
        where p.id = (v_item->>'producto_id')::uuid
        for update of p;

      if not found then
        raise exception 'Producto % no está disponible en esta feria', v_item->>'producto_id';
      end if;

      if v_producto.precio_override is not null then
        v_precio := v_producto.precio_override;
        v_categoria_nombre := null;
      else
        select nombre, precio into v_categoria_nombre, v_precio
          from categorias_precio where id = v_producto.categoria_precio_id;
        if not found then
          raise exception 'El producto "%" no tiene precio asignado en esta feria', v_producto.nombre;
        end if;
      end if;

      update productos set stock = stock - v_cantidad
        where id = v_producto.id and stock >= v_cantidad;
      if not found then
        raise exception 'No queda suficiente stock de "%"', v_producto.nombre;
      end if;

      for v_insumo in
        select pi.insumo_id, pi.cantidad, i.nombre as insumo_nombre
        from producto_insumos pi join insumos i on i.id = pi.insumo_id
        where pi.producto_id = v_producto.id
      loop
        update insumos set stock = stock - (v_insumo.cantidad * v_cantidad)
          where id = v_insumo.insumo_id and stock >= (v_insumo.cantidad * v_cantidad);
        if not found then
          raise exception 'No queda suficiente insumo "%" para "%"', v_insumo.insumo_nombre, v_producto.nombre;
        end if;
      end loop;

      insert into venta_items (venta_id, tipo, producto_id, producto_nombre, categoria_precio_nombre, cantidad, precio_unitario)
        values (v_venta_id, 'producto', v_producto.id, v_producto.nombre, v_categoria_nombre, v_cantidad, v_precio);

      v_total := v_total + v_precio * v_cantidad;

    elsif v_item->>'tipo' = 'combo' then
      select * into v_combo from combos where id = (v_item->>'combo_id')::uuid and activo for update;
      if not found then
        raise exception 'Combo % no está disponible', v_item->>'combo_id';
      end if;

      insert into venta_items (venta_id, tipo, combo_id, producto_nombre, cantidad, precio_unitario)
        values (v_venta_id, 'combo', v_combo.id, v_combo.nombre, 1, v_combo.precio)
        returning id into v_venta_item_id;

      v_total := v_total + v_combo.precio;

      for v_producto_id_text in select jsonb_array_elements_text(v_item->'producto_ids')
      loop
        select id, nombre into v_producto from productos where id = v_producto_id_text::uuid for update;
        if not found then
          raise exception 'Producto % del combo no existe', v_producto_id_text;
        end if;

        update productos set stock = stock - 1 where id = v_producto.id and stock >= 1;
        if not found then
          raise exception 'No queda suficiente stock de "%" para el combo', v_producto.nombre;
        end if;

        insert into venta_item_combo_productos (venta_item_id, producto_id, producto_nombre)
          values (v_venta_item_id, v_producto.id, v_producto.nombre);

        for v_insumo in
          select pi.insumo_id, pi.cantidad, i.nombre as insumo_nombre
          from producto_insumos pi join insumos i on i.id = pi.insumo_id
          where pi.producto_id = v_producto.id
        loop
          update insumos set stock = stock - v_insumo.cantidad
            where id = v_insumo.insumo_id and stock >= v_insumo.cantidad;
          if not found then
            raise exception 'No queda suficiente insumo "%" para "%"', v_insumo.insumo_nombre, v_producto.nombre;
          end if;
        end loop;
      end loop;
    end if;
  end loop;

  update ventas set total = v_total where id = v_venta_id;

  return query select v_venta_id, v_total;
end;
$$;

grant execute on function confirmar_venta(uuid, jsonb) to authenticated;
```

Correr en el SQL Editor de Supabase.

- [ ] **Step 2: Verificación manual**

En el SQL Editor, con un producto y una feria ya existentes (crear uno de prueba si hace falta: `insert into productos (nombre, stock) values ('Test', 5) returning id;` y vincularlo con `insert into feria_productos (feria_id, producto_id) select id, '<producto_id>' from ferias where slug='stickers';`), correr:

```sql
select * from confirmar_venta(
  (select id from ferias where slug = 'stickers'),
  '[{"tipo":"producto","producto_id":"<producto_id>","cantidad":1}]'::jsonb
);
```

Sin categoría asignada, esto debe fallar con el mensaje `El producto "Test" no tiene precio asignado en esta feria` — confirma que la función revierte correctamente ante datos incompletos. Luego asignarle una categoría con precio y repetir: debe devolver una fila `(venta_id, total)`. Correr `select stock from productos where nombre = 'Test';` → debe haber bajado en 1. Borrar los datos de prueba (`delete from productos where nombre = 'Test';`, cascada borra `feria_productos`/`ventas` asociadas) para no dejar basura.

- [ ] **Step 3: Commit**

```bash
git add sql/rpc_confirmar_venta.sql
git commit -m "Add atomic confirmar_venta RPC for cart checkout"
```

---

### Task 3: Esqueleto de la app (HTML, CSS base, cliente Supabase)

**Files:**
- Create: `index.html`
- Create: `styles.css`
- Create: `js/config.js`
- Create: `js/supabaseClient.js`
- Create: `js/app.js`

**Interfaces:**
- Produces: `supabase` (Supabase client instance) exported from `js/supabaseClient.js`, imported by every other `js/` module in later tasks.

- [ ] **Step 1: Crear `index.html`**

```html
<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0" />
  <title>Feria de Sofy</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Quicksand:wght@500;600;700&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="styles.css" />
  <script src="https://cdn.jsdelivr.net/npm/canvas-confetti@1.9.3/dist/confetti.browser.min.js"></script>
</head>
<body>
  <div id="connection-banner" class="banner banner--offline hidden">📡 Sin conexión — no se pueden confirmar ventas hasta reconectar</div>

  <section id="login-gate" class="screen">
    <div class="pin-card">
      <h1>🌸 Feria de Sofy</h1>
      <p>Ingresá tu correo para entrar</p>
      <form id="login-form">
        <input id="login-email" type="email" placeholder="tu@correo.com" required autocomplete="email" />
        <button type="submit">Enviar link</button>
      </form>
      <p id="login-message" class="hidden"></p>
    </div>
  </section>

  <section id="feria-selector" class="screen hidden">
    <h1>🌸 Feria de Sofy</h1>
    <p>¿En cuál feria vas a trabajar?</p>
    <div id="feria-cards" class="feria-cards"></div>
    <button id="btn-nueva-feria" class="btn btn--secondary">+ Nueva feria</button>
    <button id="btn-reporte-general" class="btn-link">📊 Reporte general</button>
  </section>

  <section id="reporte-general" class="screen hidden">
    <header class="feria-header">
      <button id="btn-volver-selector" class="btn-link">&larr; Volver</button>
      <h1>📊 Reporte general</h1>
    </header>
    <main id="reporte-general-content"></main>
  </section>

  <section id="feria-view" class="screen hidden">
    <header class="feria-header">
      <button id="btn-cambiar-feria" class="btn-link">&larr; Cambiar feria</button>
      <h1 id="feria-titulo"></h1>
    </header>

    <nav class="tabs">
      <button class="tab-btn active" data-tab="vender">🛒 Vender</button>
      <button class="tab-btn" data-tab="inventario">📦 Inventario</button>
      <button class="tab-btn" data-tab="ideas">💡 Ideas</button>
      <button class="tab-btn" data-tab="reportes">📊 Reportes</button>
    </nav>

    <main id="tab-vender" class="tab-panel"></main>
    <main id="tab-inventario" class="tab-panel hidden"></main>
    <main id="tab-ideas" class="tab-panel hidden"></main>
    <main id="tab-reportes" class="tab-panel hidden"></main>
  </section>

  <script type="module" src="js/app.js"></script>
</body>
</html>
```

- [ ] **Step 2: Crear `styles.css` (base, se completa en Tarea 16)**

```css
:root {
  --accent: #FF8FB1;
  --bg: #FFD6E8;
  --white: #FFFFFF;
  --text: #4A2C3A;
  --radius: 16px;
  --shadow: 0 4px 12px rgba(255, 143, 177, 0.25);
}

* { box-sizing: border-box; }

body {
  margin: 0;
  font-family: 'Quicksand', sans-serif;
  background: var(--bg);
  color: var(--text);
}

.hidden { display: none !important; }

.screen {
  min-height: 100vh;
  padding: 24px 16px;
}

.btn, button {
  font-family: inherit;
  font-weight: 600;
  border: none;
  border-radius: var(--radius);
  padding: 12px 20px;
  background: var(--accent);
  color: white;
  cursor: pointer;
  box-shadow: var(--shadow);
}

.btn--secondary {
  background: white;
  color: var(--accent);
  border: 2px solid var(--accent);
}

.btn-link {
  background: none;
  box-shadow: none;
  color: var(--accent);
  text-decoration: underline;
  padding: 4px;
}

.error { color: #C0392B; }
```

- [ ] **Step 3: Crear `js/config.js`**

```js
export const SUPABASE_URL = 'https://YOUR-PROJECT.supabase.co';
export const SUPABASE_ANON_KEY = 'YOUR-ANON-KEY';
```

Reemplazar los valores con la Project URL y anon key copiadas en la Tarea 1, Step 2.

- [ ] **Step 4: Crear `js/supabaseClient.js`**

```js
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
```

- [ ] **Step 5: Crear `js/app.js` (verificación de conectividad temporal)**

```js
import { supabase } from './supabaseClient.js';

async function checkConnection() {
  const { count, error } = await supabase.from('ferias').select('*', { count: 'exact', head: true });
  if (error) {
    console.error('Error conectando a Supabase:', error.message);
  } else {
    console.log(`Conectado a Supabase. Ferias en la base: ${count}`);
  }
}

checkConnection();
```

- [ ] **Step 6: Verificación manual**

Correr `python -m http.server 8000` desde la raíz del proyecto. Abrir `http://localhost:8000` en el navegador, abrir la consola de devtools. Debe verse `Conectado a Supabase. Ferias en la base: 2` sin errores.

- [ ] **Step 7: Commit**

```bash
git add index.html styles.css js/config.js js/supabaseClient.js js/app.js
git commit -m "Add app skeleton wired to Supabase"
```

---

### Task 4: Login con link mágico (Supabase Auth)

**Files:**
- Create: `js/auth.js`
- Modify: `js/app.js`

**Interfaces:**
- Produces: `initAuth(onSignedIn: (session) => void)` — muestra `#login-gate`, y llama `onSignedIn` cuando hay sesión activa (al cargar si ya había sesión, o tras clickear el link mágico).

- [ ] **Step 1: Crear `js/auth.js`**

```js
import { supabase } from './supabaseClient.js';

export function initAuth(onSignedIn) {
  const screen = document.getElementById('login-gate');
  const form = document.getElementById('login-form');
  const input = document.getElementById('login-email');
  const message = document.getElementById('login-message');
  const submitBtn = form.querySelector('button');

  supabase.auth.onAuthStateChange((_event, session) => {
    if (session) {
      screen.classList.add('hidden');
      onSignedIn(session);
    } else {
      screen.classList.remove('hidden');
    }
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    message.classList.add('hidden');
    submitBtn.disabled = true;
    submitBtn.textContent = 'Enviando...';

    const { error } = await supabase.auth.signInWithOtp({
      email: input.value.trim(),
      options: {
        shouldCreateUser: false,
        emailRedirectTo: window.location.origin + window.location.pathname,
      },
    });

    submitBtn.disabled = false;
    submitBtn.textContent = 'Enviar link';
    message.classList.remove('hidden');

    if (error) {
      message.textContent = `No pudimos enviarte el link: ${error.message}`;
      message.classList.add('error');
    } else {
      message.textContent = 'Revisá tu correo 💌 — te mandamos un link para entrar';
      message.classList.remove('error');
    }
  });
}
```

- [ ] **Step 2: Modificar `js/app.js`**

Reemplazar el contenido completo por:

```js
import { initAuth } from './auth.js';

function onSignedIn(session) {
  console.log('Sesión iniciada:', session.user.email);
}

initAuth(onSignedIn);
```

- [ ] **Step 3: Verificación manual**

Con el servidor local corriendo, abrir `http://localhost:8000`. Debe verse la pantalla de login. Ingresar un correo **no invitado** → debe mostrar un mensaje de error (no "revisá tu correo"). Ingresar el correo invitado en la Tarea 1 → debe mostrar "Revisá tu correo 💌". Abrir ese correo, clickear el link → vuelve a `localhost:8000` y la consola debe mostrar `Sesión iniciada: <ese correo>`. Recargar la página → debe seguir logueado sin pedir el correo de nuevo (sesión persistida).

- [ ] **Step 4: Commit**

```bash
git add js/auth.js js/app.js
git commit -m "Add magic-link login gated by Supabase Auth whitelist"
```

---

### Task 5: Utilidades de UI compartidas (modal de confirmación, toast)

**Files:**
- Create: `js/ui.js`

**Interfaces:**
- Produces: `confirmDialog(message: string): Promise<boolean>`, `toast(message: string): void`. Usadas por Tareas 7-11.

- [ ] **Step 1: Crear `js/ui.js`**

```js
export function confirmDialog(message) {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal">
        <p>${message}</p>
        <div class="modal-actions">
          <button class="btn btn--secondary" data-action="no">Cancelar</button>
          <button class="btn" data-action="si">Confirmar</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    overlay.addEventListener('click', (e) => {
      const action = e.target.dataset.action;
      if (!action) return;
      document.body.removeChild(overlay);
      resolve(action === 'si');
    });
  });
}

export function toast(message) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = message;
  document.body.appendChild(el);
  setTimeout(() => el.classList.add('toast--visible'), 10);
  setTimeout(() => {
    el.classList.remove('toast--visible');
    setTimeout(() => el.remove(), 300);
  }, 2500);
}
```

- [ ] **Step 2: Agregar estilos mínimos a `styles.css`**

Agregar al final del archivo:

```css
.modal-overlay {
  position: fixed; inset: 0;
  background: rgba(0,0,0,0.4);
  display: flex; align-items: center; justify-content: center;
  z-index: 100;
}
.modal {
  background: white; border-radius: var(--radius);
  padding: 20px; max-width: 90vw; width: 340px;
  box-shadow: var(--shadow);
}
.modal-actions { display: flex; gap: 8px; margin-top: 16px; justify-content: flex-end; }

.toast {
  position: fixed; bottom: 16px; left: 50%; transform: translate(-50%, 20px);
  background: var(--text); color: white; padding: 10px 18px;
  border-radius: var(--radius); opacity: 0; transition: all 0.3s;
  z-index: 200;
}
.toast--visible { opacity: 1; transform: translate(-50%, 0); }
```

- [ ] **Step 3: Verificación manual**

No hay UI que dispare esto todavía — se verifica en conjunto con la Tarea 7 en adelante. Confirmar solo que no hay errores de sintaxis: abrir la consola del navegador con la app cargada, correr `import('./js/ui.js').then(m => m.toast('probando'))` — debe aparecer y desaparecer un toast rosa abajo.

- [ ] **Step 4: Commit**

```bash
git add js/ui.js styles.css
git commit -m "Add shared confirm dialog and toast UI helpers"
```

---

### Task 6: Selector de feria + crear nueva feria

**Files:**
- Create: `js/ferias.js`
- Modify: `js/app.js`

**Interfaces:**
- Produces: `initFeriaSelector(onSelect: (feria) => void)` — muestra `#feria-selector`, renderiza tarjetas, llama `onSelect(feria)` al elegir una.
- Consumes: `supabase` de `js/supabaseClient.js`, `toast` de `js/ui.js`.

- [ ] **Step 1: Crear `js/ferias.js`**

```js
import { supabase } from './supabaseClient.js';
import { toast } from './ui.js';

function slugify(nombre) {
  return nombre.toLowerCase().trim().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || `feria-${Math.random().toString(36).slice(2)}`;
}

export async function initFeriaSelector(onSelect) {
  const screen = document.getElementById('feria-selector');
  const cardsContainer = document.getElementById('feria-cards');
  const btnNueva = document.getElementById('btn-nueva-feria');

  screen.classList.remove('hidden');
  await render();

  btnNueva.onclick = async () => {
    const nombre = prompt('Nombre de la nueva feria:');
    if (!nombre || !nombre.trim()) return;
    const emoji = prompt('Un emoji para representarla (ej: 🌸):', '🌸') || '🌸';
    const { error } = await supabase.from('ferias').insert({ nombre: nombre.trim(), emoji: emoji.trim(), slug: slugify(nombre) });
    if (error) {
      toast('No se pudo crear la feria');
      return;
    }
    toast('¡Feria creada! 🌸');
    await render();
  };

  async function render() {
    cardsContainer.innerHTML = '<p>Cargando...</p>';
    const { data: ferias, error } = await supabase.from('ferias').select('*').order('nombre');
    if (error) {
      cardsContainer.innerHTML = '<p class="error">No se pudieron cargar las ferias</p>';
      return;
    }
    cardsContainer.innerHTML = '';
    ferias.forEach((feria) => {
      const card = document.createElement('button');
      card.className = 'feria-card';
      card.innerHTML = `<span class="feria-card__emoji">${feria.emoji}</span><span class="feria-card__nombre">${feria.nombre}</span>`;
      card.addEventListener('click', () => {
        screen.classList.add('hidden');
        onSelect(feria);
      });
      cardsContainer.appendChild(card);
    });
  }
}
```

- [ ] **Step 2: Modificar `js/app.js`**

Reemplazar el contenido completo por:

```js
import { initAuth } from './auth.js';
import { initFeriaSelector } from './ferias.js';

function showFeriaSelector() {
  initFeriaSelector((feria) => {
    console.log('Feria elegida:', feria.nombre);
  });
}

initAuth(showFeriaSelector);
```

- [ ] **Step 3: Agregar estilos de tarjetas a `styles.css`**

```css
.feria-cards { display: flex; flex-direction: column; gap: 12px; margin: 20px 0; }
.feria-card {
  display: flex; align-items: center; gap: 12px;
  background: white; padding: 20px; text-align: left;
  font-size: 1.2rem;
}
.feria-card__emoji { font-size: 2rem; }
```

- [ ] **Step 4: Verificación manual**

Recargar la app, loguearse. Debe verse el selector con las 2 ferias sembradas. Clickear "+ Nueva feria", ingresar un nombre de prueba (ej. "Feria de prueba") y un emoji → debe aparecer una tercera tarjeta. Clickear cualquier tarjeta → la consola debe loguear `Feria elegida: <nombre>`. Borrar la feria de prueba desde el SQL Editor de Supabase (`delete from ferias where nombre = 'Feria de prueba';`) para no dejarla.

- [ ] **Step 5: Commit**

```bash
git add js/ferias.js js/app.js styles.css
git commit -m "Add fair selector with in-app fair creation"
```

---

### Task 7: Navegación por pestañas dentro de una feria (con stubs)

**Files:**
- Create: `js/nav.js`
- Create: `js/vender.js` (stub)
- Create: `js/inventario.js` (stub)
- Create: `js/ideas.js` (stub)
- Create: `js/reportes.js` (stub)
- Modify: `js/app.js`

**Interfaces:**
- Produces: `initFeriaView(feria, { onExit: () => void })` — muestra `#feria-view`, maneja las 4 pestañas, llama a `initVender/initInventario/initIdeas/initReportes(feria)` de forma perezosa (solo la primera vez que se visita cada pestaña).
- Consumes de cada stub: `initX(feria): (() => void) | undefined` — cada módulo de pestaña exporta una función que recibe la feria, pinta su contenido en `#tab-X`, y devuelve una función de limpieza opcional (para cancelar suscripciones realtime al salir).

- [ ] **Step 1: Crear los 4 stubs**

`js/vender.js`:
```js
export function initVender(feria) {
  document.getElementById('tab-vender').innerHTML = '<p>Próximamente: pantalla de venta.</p>';
  return () => {};
}
```

`js/inventario.js`:
```js
export function initInventario(feria) {
  document.getElementById('tab-inventario').innerHTML = '<p>Próximamente: inventario.</p>';
  return () => {};
}
```

`js/ideas.js`:
```js
export function initIdeas(feria) {
  document.getElementById('tab-ideas').innerHTML = '<p>Próximamente: ideas.</p>';
  return () => {};
}
```

`js/reportes.js`:
```js
export function initReportes(feria) {
  document.getElementById('tab-reportes').innerHTML = '<p>Próximamente: reportes.</p>';
  return () => {};
}
```

- [ ] **Step 2: Crear `js/nav.js`**

```js
import { initVender } from './vender.js';
import { initInventario } from './inventario.js';
import { initIdeas } from './ideas.js';
import { initReportes } from './reportes.js';

const TABS = ['vender', 'inventario', 'ideas', 'reportes'];
const INIT_FNS = { vender: initVender, inventario: initInventario, ideas: initIdeas, reportes: initReportes };

let currentFeria = null;
let currentCleanups = {};
let tabButtonsBound = false;

function clearTab(tab) {
  if (currentCleanups[tab]) {
    currentCleanups[tab]();
    currentCleanups[tab] = null;
  }
  document.getElementById(`tab-${tab}`).innerHTML = '';
}

function showTab(tab) {
  TABS.forEach((t) => {
    document.getElementById(`tab-${t}`).classList.toggle('hidden', t !== tab);
  });
  document.querySelectorAll('.tab-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.tab === tab);
  });
  if (!currentCleanups[tab]) {
    const cleanup = INIT_FNS[tab](currentFeria);
    currentCleanups[tab] = cleanup || (() => {});
  }
}

export function initFeriaView(feria, { onExit }) {
  TABS.forEach(clearTab);
  currentFeria = feria;

  const view = document.getElementById('feria-view');
  const titulo = document.getElementById('feria-titulo');
  view.classList.remove('hidden');
  titulo.textContent = `${feria.emoji} ${feria.nombre}`;

  if (!tabButtonsBound) {
    document.querySelectorAll('.tab-btn').forEach((btn) => {
      btn.addEventListener('click', () => showTab(btn.dataset.tab));
    });
    tabButtonsBound = true;
  }

  document.getElementById('btn-cambiar-feria').onclick = () => {
    TABS.forEach(clearTab);
    view.classList.add('hidden');
    onExit();
  };

  showTab('vender');
}
```

- [ ] **Step 3: Modificar `js/app.js`**

Reemplazar el contenido completo por:

```js
import { initAuth } from './auth.js';
import { initFeriaSelector } from './ferias.js';
import { initFeriaView } from './nav.js';

function showFeriaSelector() {
  document.getElementById('feria-view').classList.add('hidden');
  initFeriaSelector((feria) => {
    initFeriaView(feria, { onExit: showFeriaSelector });
  });
}

initAuth(showFeriaSelector);
```

- [ ] **Step 4: Agregar estilos de tabs a `styles.css`**

```css
.feria-header { display: flex; flex-direction: column; gap: 4px; margin-bottom: 12px; }
.tabs { display: flex; gap: 4px; margin-bottom: 16px; overflow-x: auto; }
.tab-btn {
  background: white; color: var(--text); box-shadow: none;
  border-radius: var(--radius) var(--radius) 0 0; opacity: 0.6;
}
.tab-btn.active { opacity: 1; background: var(--accent); color: white; }
```

- [ ] **Step 5: Verificación manual**

Elegir una feria. Debe verse la pestaña "Vender" activa con el texto "Próximamente: pantalla de venta." Clickear cada una de las otras 3 pestañas → cada una debe mostrar su propio texto "Próximamente" y resaltarse como activa. Clickear "← Cambiar feria" → vuelve al selector. Elegir la otra feria → vuelve a "Vender" por defecto.

- [ ] **Step 6: Commit**

```bash
git add js/nav.js js/vender.js js/inventario.js js/ideas.js js/reportes.js js/app.js styles.css
git commit -m "Add tab navigation within a fair with lazy-loaded stub tabs"
```

---

### Task 8: Inventario — categorías de precio y combos

**Files:**
- Modify: `js/inventario.js`

**Interfaces:**
- Consumes: `supabase`, `confirmDialog`, `toast`.
- Produces (usado en Tareas 9 y 11): tablas `categorias_precio` y `combos` pobladas — Tarea 9 lee `categorias_precio` para el selector de categoría al crear/editar un producto; Tarea 11 lee `combos` (activos) para los botones de combo en Vender.

- [ ] **Step 1: Reemplazar `js/inventario.js`**

```js
import { supabase } from './supabaseClient.js';
import { confirmDialog, toast } from './ui.js';

export function initInventario(feria) {
  const container = document.getElementById('tab-inventario');
  container.innerHTML = '<p>Cargando inventario...</p>';
  render(feria, container);
  return () => {};
}

async function render(feria, container) {
  const [{ data: categorias }, { data: combos }] = await Promise.all([
    supabase.from('categorias_precio').select('*').eq('feria_id', feria.id).order('orden'),
    supabase.from('combos').select('*').eq('feria_id', feria.id).order('nombre'),
  ]);

  container.innerHTML = `
    <section class="inv-section">
      <h2>Categorías de precio</h2>
      <div id="inv-categorias" class="inv-list"></div>
      <form id="form-categoria" class="inv-form">
        <input name="nombre" placeholder="Nombre (ej: Chico)" required />
        <input name="precio" type="number" step="1" min="0" placeholder="Precio" required />
        <button type="submit">Agregar categoría</button>
      </form>
    </section>

    <section class="inv-section">
      <h2>Combos</h2>
      <div id="inv-combos" class="inv-list"></div>
      <form id="form-combo" class="inv-form">
        <input name="nombre" placeholder="Nombre (ej: Combo 3 stickers)" required />
        <input name="cantidad" type="number" min="1" placeholder="Cantidad de productos" required />
        <input name="precio" type="number" step="1" min="0" placeholder="Precio del combo" required />
        <button type="submit">Agregar combo</button>
      </form>
    </section>

    <section class="inv-section" id="inv-productos-section">
      <p>La sección de Productos se agrega en la Tarea 9.</p>
    </section>
  `;

  renderCategorias(feria, categorias, container);
  renderCombos(feria, combos, container);

  container.querySelector('#form-categoria').addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.target;
    await supabase.from('categorias_precio').insert({
      feria_id: feria.id,
      nombre: form.nombre.value.trim(),
      precio: Number(form.precio.value),
      orden: categorias.length,
    });
    render(feria, container);
  });

  container.querySelector('#form-combo').addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.target;
    await supabase.from('combos').insert({
      feria_id: feria.id,
      nombre: form.nombre.value.trim(),
      cantidad: Number(form.cantidad.value),
      precio: Number(form.precio.value),
    });
    render(feria, container);
  });
}

function renderCategorias(feria, categorias, container) {
  const list = container.querySelector('#inv-categorias');
  list.innerHTML = categorias.map((c) => `
    <div class="inv-row" data-id="${c.id}">
      <span>${c.nombre} — $${c.precio}</span>
      <button class="btn-icon" data-action="eliminar-categoria" data-id="${c.id}">🗑️</button>
    </div>
  `).join('') || '<p class="inv-empty">Todavía no hay categorías de precio</p>';

  list.querySelectorAll('[data-action="eliminar-categoria"]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const ok = await confirmDialog('¿Eliminar esta categoría de precio? Los productos que la usan quedarán sin categoría.');
      if (!ok) return;
      await supabase.from('categorias_precio').delete().eq('id', btn.dataset.id);
      render(feria, container);
    });
  });
}

function renderCombos(feria, combos, container) {
  const list = container.querySelector('#inv-combos');
  list.innerHTML = combos.map((c) => `
    <div class="inv-row" data-id="${c.id}">
      <span>${c.nombre} — ${c.cantidad} productos por $${c.precio} ${c.activo ? '' : '(inactivo)'}</span>
      <button class="btn-icon" data-action="toggle-combo" data-id="${c.id}" data-activo="${c.activo}">${c.activo ? '⏸️' : '▶️'}</button>
      <button class="btn-icon" data-action="eliminar-combo" data-id="${c.id}">🗑️</button>
    </div>
  `).join('') || '<p class="inv-empty">Todavía no hay combos</p>';

  list.querySelectorAll('[data-action="toggle-combo"]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      await supabase.from('combos').update({ activo: btn.dataset.activo !== 'true' }).eq('id', btn.dataset.id);
      render(feria, container);
    });
  });

  list.querySelectorAll('[data-action="eliminar-combo"]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const ok = await confirmDialog('¿Eliminar este combo?');
      if (!ok) return;
      await supabase.from('combos').delete().eq('id', btn.dataset.id);
      render(feria, container);
    });
  });
}
```

- [ ] **Step 2: Agregar estilos de inventario a `styles.css`**

```css
.inv-section { background: white; border-radius: var(--radius); padding: 16px; margin-bottom: 16px; }
.inv-row { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 8px 0; border-bottom: 1px solid #f3d5e2; }
.inv-empty { opacity: 0.6; font-style: italic; }
.inv-form { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 12px; }
.inv-form input, .inv-form select { flex: 1; min-width: 100px; padding: 8px; border-radius: 8px; border: 1px solid #f3d5e2; font-family: inherit; }
.btn-icon { background: none; box-shadow: none; padding: 4px 8px; font-size: 1.1rem; }
```

- [ ] **Step 3: Verificación manual**

Entrar a una feria → pestaña Inventario. Agregar una categoría "Chico" $500 → debe aparecer en la lista. Agregar un combo "Combo 3 x $1000" (cantidad 3) → debe aparecer. Clickear ⏸️ en el combo → debe pasar a "(inactivo)" y el ícono cambia a ▶️. Eliminar la categoría → debe pedir confirmación y desaparecer de la lista. Recargar la página, volver a Inventario → los datos deben seguir ahí (persistidos).

- [ ] **Step 4: Commit**

```bash
git add js/inventario.js styles.css
git commit -m "Add price category and combo management to Inventario tab"
```

---

### Task 9: Inventario — productos (crear, editar, reutilizar entre ferias)

**Files:**
- Modify: `js/inventario.js`

**Interfaces:**
- Consumes: `categorias_precio` (Tarea 8), tabla `feria_productos`.
- Produces (usado en Tarea 10, 11 y 13): productos vinculados vía `feria_productos` a la feria actual, con foto, categoría y stock — es lo que la pestaña Vender lista.

- [ ] **Step 1: Reemplazar la sección de productos en `js/inventario.js`**

Reemplazar el bloque `<section class="inv-section" id="inv-productos-section">...</section>` dentro del template literal de `render()` por:

```html
    <section class="inv-section" id="inv-productos-section">
      <h2>Productos</h2>
      <div id="inv-productos" class="inv-list"></div>
      <form id="form-producto" class="inv-form">
        <input name="nombre" placeholder="Nombre del producto" required />
        <select name="categoria_precio_id">
          <option value="">Sin categoría</option>
          ${categorias.map((c) => `<option value="${c.id}">${c.nombre} ($${c.precio})</option>`).join('')}
        </select>
        <input name="stock" type="number" min="0" placeholder="Stock inicial" required />
        <input name="foto" type="file" accept="image/*" />
        <button type="submit">Agregar producto</button>
      </form>
      <button id="btn-reutilizar" class="btn btn--secondary" type="button">↩️ Reutilizar producto de otra feria</button>
    </section>
```

Y agregar, al final de la función `render()` (después del listener de `#form-combo`), antes del cierre de la función:

```js
  const { data: productos } = await supabase
    .from('feria_productos')
    .select('id, categoria_precio_id, precio_override, productos(id, nombre, imagen_url, stock)')
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
      const path = `${crypto.randomUUID()}-${file.name}`;
      const { error: uploadError } = await supabase.storage.from('productos-fotos').upload(path, file);
      if (!uploadError) {
        imagen_url = supabase.storage.from('productos-fotos').getPublicUrl(path).data.publicUrl;
      } else {
        toast('No se pudo subir la foto, se guarda el producto sin foto');
      }
    }

    const { data: producto, error: prodError } = await supabase
      .from('productos')
      .insert({ nombre: form.nombre.value.trim(), stock: Number(form.stock.value), imagen_url })
      .select()
      .single();

    if (prodError) {
      toast('No se pudo crear el producto');
      submitBtn.disabled = false;
      submitBtn.textContent = 'Agregar producto';
      return;
    }

    await supabase.from('feria_productos').insert({
      feria_id: feria.id,
      producto_id: producto.id,
      categoria_precio_id: form.categoria_precio_id.value || null,
    });

    render(feria, container);
  });

  container.querySelector('#btn-reutilizar').addEventListener('click', () => abrirReutilizarModal(feria, categorias, container));
```

- [ ] **Step 2: Agregar `renderProductos` y `abrirReutilizarModal` a `js/inventario.js`**

Agregar estas dos funciones al final del archivo:

```js
function renderProductos(feria, feriaProductos, categorias, container) {
  const list = container.querySelector('#inv-productos');
  list.innerHTML = feriaProductos.map((fp) => {
    const p = fp.productos;
    const categoria = categorias.find((c) => c.id === fp.categoria_precio_id);
    const precioTexto = fp.precio_override != null
      ? `$${fp.precio_override} (override)`
      : categoria ? `$${categoria.precio} (${categoria.nombre})` : 'sin precio';
    return `
      <div class="inv-row" data-id="${fp.id}">
        ${p.imagen_url ? `<img class="inv-row__foto" src="${p.imagen_url}" alt="${p.nombre}" />` : ''}
        <span>${p.nombre} — ${precioTexto} — Stock: ${p.stock}</span>
        <input type="number" class="inv-stock-input" data-producto-id="${p.id}" value="${p.stock}" min="0" />
        <select class="inv-categoria-select" data-id="${fp.id}">
          <option value="">Sin categoría</option>
          ${categorias.map((c) => `<option value="${c.id}" ${fp.categoria_precio_id === c.id ? 'selected' : ''}>${c.nombre}</option>`).join('')}
        </select>
        <button class="btn-icon" data-action="quitar-de-feria" data-id="${fp.id}">➖</button>
        <button class="btn-icon" data-action="eliminar-producto" data-producto-id="${p.id}">🗑️</button>
      </div>
    `;
  }).join('') || '<p class="inv-empty">Todavía no hay productos en esta feria</p>';

  list.querySelectorAll('.inv-stock-input').forEach((input) => {
    input.addEventListener('change', async () => {
      await supabase.from('productos').update({ stock: Number(input.value) }).eq('id', input.dataset.productoId);
    });
  });

  list.querySelectorAll('.inv-categoria-select').forEach((select) => {
    select.addEventListener('change', async () => {
      await supabase.from('feria_productos').update({ categoria_precio_id: select.value || null }).eq('id', select.dataset.id);
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
      const ok = await confirmDialog('¿Eliminar este producto por completo, de TODAS las ferias que lo usan? Las ventas ya registradas se conservan.');
      if (!ok) return;
      await supabase.from('productos').delete().eq('id', btn.dataset.productoId);
      render(feria, container);
    });
  });
}

async function abrirReutilizarModal(feriaActual, categoriasActuales, container) {
  const { data: otrasFerias } = await supabase.from('ferias').select('*').neq('id', feriaActual.id).order('nombre');
  if (!otrasFerias || otrasFerias.length === 0) {
    toast('No hay otra feria de la cual reutilizar productos todavía');
    return;
  }

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal">
      <p>Elegí de cuál feria traer productos:</p>
      <select id="reutilizar-feria-select">
        ${otrasFerias.map((f) => `<option value="${f.id}">${f.emoji} ${f.nombre}</option>`).join('')}
      </select>
      <div id="reutilizar-productos-list" class="inv-list"></div>
      <div class="modal-actions">
        <button class="btn btn--secondary" data-action="cerrar">Cerrar</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  async function cargarProductosDeFeria(feriaId) {
    const { data: yaEnEstaFeria } = await supabase.from('feria_productos').select('producto_id').eq('feria_id', feriaActual.id);
    const idsYaVinculados = new Set((yaEnEstaFeria || []).map((r) => r.producto_id));

    const { data: fps } = await supabase
      .from('feria_productos')
      .select('producto_id, productos(id, nombre, imagen_url, stock)')
      .eq('feria_id', feriaId);

    const disponibles = (fps || []).filter((fp) => !idsYaVinculados.has(fp.producto_id));
    const list = overlay.querySelector('#reutilizar-productos-list');
    list.innerHTML = disponibles.map((fp) => `
      <div class="inv-row">
        <span>${fp.productos.nombre} (stock: ${fp.productos.stock})</span>
        <button class="btn-icon" data-action="agregar-producto" data-id="${fp.productos.id}">➕</button>
      </div>
    `).join('') || '<p class="inv-empty">No hay productos nuevos para traer de esa feria</p>';

    list.querySelectorAll('[data-action="agregar-producto"]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        await supabase.from('feria_productos').insert({ feria_id: feriaActual.id, producto_id: btn.dataset.id });
        toast('Producto agregado a esta feria');
        document.body.removeChild(overlay);
        render(feriaActual, container);
      });
    });
  }

  const select = overlay.querySelector('#reutilizar-feria-select');
  select.addEventListener('change', () => cargarProductosDeFeria(select.value));
  await cargarProductosDeFeria(select.value);

  overlay.addEventListener('click', (e) => {
    if (e.target.dataset.action === 'cerrar') document.body.removeChild(overlay);
  });
}
```

- [ ] **Step 2: Verificación manual**

En una feria, agregar un producto "Sticker de prueba" con stock 10 y una foto cualquiera → debe aparecer en la lista con su foto y "Stock: 10". Cambiar el stock a 7 desde el input → recargar la página → debe seguir en 7. Ir a la OTRA feria, Inventario → "↩️ Reutilizar producto de otra feria" → elegir la primera feria → debe listarse "Sticker de prueba (stock: 7)" → clickear ➕ → debe aparecer ahora en la segunda feria también, con el mismo stock 7. Cambiar su stock a 3 desde la segunda feria → volver a la primera feria → debe mostrar también 3 (stock compartido confirmado). Eliminar el producto por completo desde cualquiera de las dos → debe desaparecer de ambas.

- [ ] **Step 3: Commit**

```bash
git add js/inventario.js
git commit -m "Add product CRUD with cross-fair reuse via shared catalog"
```

---

### Task 10: Inventario — insumos y receta por producto

**Files:**
- Create: `js/insumos.js`
- Modify: `js/inventario.js`

**Interfaces:**
- Produces: `renderInsumosSection(container: HTMLElement): Promise<void>` (pinta la sub-sección de insumos dentro de un contenedor dado), `fetchInsumos(): Promise<Array<{id, nombre, stock}>>` (usado por el editor de receta).
- Consumes en `inventario.js`: agrega un botón "🧪 Receta" por producto que abre un editor de `producto_insumos`.

- [ ] **Step 1: Crear `js/insumos.js`**

```js
import { supabase } from './supabaseClient.js';
import { confirmDialog } from './ui.js';

export async function fetchInsumos() {
  const { data } = await supabase.from('insumos').select('*').order('nombre');
  return data || [];
}

export async function renderInsumosSection(container) {
  const insumos = await fetchInsumos();

  container.innerHTML = `
    <h2>Insumos</h2>
    <p class="inv-hint">Empaques y materiales que se descuentan solos al vender, sin venderse ellos mismos (ej. bolsitas).</p>
    <div id="inv-insumos" class="inv-list"></div>
    <form id="form-insumo" class="inv-form">
      <input name="nombre" placeholder="Nombre (ej: Bolsita transparente)" required />
      <input name="stock" type="number" min="0" placeholder="Stock inicial" required />
      <button type="submit">Agregar insumo</button>
    </form>
  `;

  const list = container.querySelector('#inv-insumos');
  list.innerHTML = insumos.map((i) => `
    <div class="inv-row" data-id="${i.id}">
      <span>${i.nombre}</span>
      <input type="number" class="insumo-stock-input" data-id="${i.id}" value="${i.stock}" min="0" />
      <button class="btn-icon" data-action="eliminar-insumo" data-id="${i.id}">🗑️</button>
    </div>
  `).join('') || '<p class="inv-empty">Todavía no hay insumos</p>';

  list.querySelectorAll('.insumo-stock-input').forEach((input) => {
    input.addEventListener('change', async () => {
      await supabase.from('insumos').update({ stock: Number(input.value) }).eq('id', input.dataset.id);
    });
  });

  list.querySelectorAll('[data-action="eliminar-insumo"]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const ok = await confirmDialog('¿Eliminar este insumo? Se quita también de la receta de los productos que lo usaban.');
      if (!ok) return;
      await supabase.from('insumos').delete().eq('id', btn.dataset.id);
      renderInsumosSection(container);
    });
  });

  container.querySelector('#form-insumo').addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.target;
    await supabase.from('insumos').insert({ nombre: form.nombre.value.trim(), stock: Number(form.stock.value) });
    renderInsumosSection(container);
  });
}

export async function abrirRecetaModal(producto) {
  const insumos = await fetchInsumos();
  const { data: receta } = await supabase.from('producto_insumos').select('*').eq('producto_id', producto.id);

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';

  function render() {
    overlay.innerHTML = `
      <div class="modal">
        <p>Receta de "${producto.nombre}" — qué insumos consume por unidad vendida</p>
        <div id="receta-list" class="inv-list">
          ${receta.map((r) => {
            const insumo = insumos.find((i) => i.id === r.insumo_id);
            return `
              <div class="inv-row">
                <span>${insumo ? insumo.nombre : '(insumo eliminado)'} x ${r.cantidad}</span>
                <button class="btn-icon" data-action="quitar-receta" data-id="${r.id}">🗑️</button>
              </div>
            `;
          }).join('') || '<p class="inv-empty">Sin insumos asignados todavía</p>'}
        </div>
        <form id="form-agregar-receta" class="inv-form">
          <select name="insumo_id">
            ${insumos.map((i) => `<option value="${i.id}">${i.nombre}</option>`).join('')}
          </select>
          <input name="cantidad" type="number" min="1" value="1" placeholder="Cantidad" required />
          <button type="submit">Agregar a la receta</button>
        </form>
        <div class="modal-actions">
          <button class="btn btn--secondary" data-action="cerrar">Cerrar</button>
        </div>
      </div>
    `;
  }

  render();
  document.body.appendChild(overlay);

  // Delegación en `overlay` (no en los elementos internos): el modal
  // reconstruye su innerHTML en cada render(), así que un listener puesto
  // directamente en el <form> quedaría huérfano después del primer cambio.
  overlay.addEventListener('click', async (e) => {
    if (e.target.dataset.action === 'cerrar') {
      document.body.removeChild(overlay);
      return;
    }
    if (e.target.dataset.action === 'quitar-receta') {
      await supabase.from('producto_insumos').delete().eq('id', e.target.dataset.id);
      const idx = receta.findIndex((r) => r.id === e.target.dataset.id);
      if (idx >= 0) receta.splice(idx, 1);
      render();
    }
  });

  overlay.addEventListener('submit', async (e) => {
    if (e.target.id !== 'form-agregar-receta') return;
    e.preventDefault();
    const form = e.target;
    const { data: nueva } = await supabase.from('producto_insumos').upsert({
      producto_id: producto.id,
      insumo_id: form.insumo_id.value,
      cantidad: Number(form.cantidad.value),
    }, { onConflict: 'producto_id,insumo_id' }).select().single();
    const idx = receta.findIndex((r) => r.insumo_id === form.insumo_id.value);
    if (idx >= 0) receta[idx] = nueva; else receta.push(nueva);
    render();
  });
}
```

- [ ] **Step 2: Modificar `js/inventario.js`**

Agregar el import al inicio del archivo:

```js
import { renderInsumosSection, abrirRecetaModal } from './insumos.js';
```

Reemplazar la sección placeholder de productos: después de la `</section>` de Productos en el template de `render()`, agregar una nueva sección:

```html
    <section class="inv-section" id="inv-insumos-section"></section>
```

Y al final de `render()`, después de `renderProductos(...)`, agregar:

```js
  renderInsumosSection(container.querySelector('#inv-insumos-section'));
```

En `renderProductos`, agregar un botón de receta junto a los otros botones por fila (dentro del `.inv-row` de cada producto, antes del botón de eliminar):

```html
        <button class="btn-icon" data-action="ver-receta" data-producto-id="${p.id}" data-producto-nombre="${p.nombre}">🧪</button>
```

Y su listener, junto a los demás `querySelectorAll` de `renderProductos`:

```js
  list.querySelectorAll('[data-action="ver-receta"]').forEach((btn) => {
    btn.addEventListener('click', () => {
      abrirRecetaModal({ id: btn.dataset.productoId, nombre: btn.dataset.productoNombre });
    });
  });
```

- [ ] **Step 3: Verificación manual**

En Inventario, agregar un insumo "Bolsita" con stock 20. En un producto existente, clickear 🧪 → se abre el modal de receta → agregar "Bolsita" x 1 → debe aparecer en la lista de la receta. Cerrar y reabrir el modal del mismo producto → la receta debe seguir ahí (persistida). Cambiar el stock de "Bolsita" a 15 desde la sección Insumos → recargar → debe seguir en 15.

- [ ] **Step 4: Commit**

```bash
git add js/insumos.js js/inventario.js
git commit -m "Add insumos catalog and per-product recipe editor"
```

---

### Task 11: Vender — carrito

**Files:**
- Modify: `js/vender.js`

**Interfaces:**
- Consumes: `feria_productos` + `productos` (Tarea 9), `combos` (Tarea 8).
- Produces (usado en Tarea 12): estado de carrito en memoria dentro del módulo, expuesto internamente; Tarea 12 extiende este mismo archivo, no importa nada nuevo de él.

- [ ] **Step 1: Reemplazar `js/vender.js`**

```js
import { supabase } from './supabaseClient.js';
import { toast } from './ui.js';

let realtimeChannel = null;
let carrito = []; // { tipo: 'producto', productoId, nombre, precio, cantidad } | { tipo: 'combo', comboId, nombre, precio, productos: [{id, nombre}] }

export function initVender(feria) {
  carrito = [];
  const container = document.getElementById('tab-vender');
  container.innerHTML = '<p>Cargando productos...</p>';

  loadAndRender(feria, container);

  realtimeChannel = supabase
    .channel(`vender-${feria.id}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'productos' }, () => loadAndRender(feria, container))
    .subscribe();

  return () => {
    if (realtimeChannel) {
      supabase.removeChannel(realtimeChannel);
      realtimeChannel = null;
    }
  };
}

async function loadAndRender(feria, container) {
  const [{ data: feriaProductos, error: prodError }, { data: combos, error: comboError }] = await Promise.all([
    supabase.from('feria_productos').select('categoria_precio_id, precio_override, productos(id, nombre, imagen_url, stock), categorias_precio(precio)').eq('feria_id', feria.id),
    supabase.from('combos').select('*').eq('feria_id', feria.id).eq('activo', true).order('nombre'),
  ]);

  if (prodError || comboError) {
    container.innerHTML = '<p class="error">No se pudieron cargar los productos</p>';
    return;
  }

  render(feria, feriaProductos || [], combos || [], container);
}

function precioEfectivo(fp) {
  if (fp.precio_override != null) return fp.precio_override;
  return fp.categorias_precio ? fp.categorias_precio.precio : null;
}

function cantidadEnCarrito(productoId) {
  let total = 0;
  carrito.forEach((linea) => {
    if (linea.tipo === 'producto' && linea.productoId === productoId) total += linea.cantidad;
    if (linea.tipo === 'combo') total += linea.productos.filter((p) => p.id === productoId).length;
  });
  return total;
}

function render(feria, feriaProductos, combos, container) {
  container.innerHTML = '';

  if (combos.length > 0) {
    const combosRow = document.createElement('div');
    combosRow.className = 'combos-row';
    combos.forEach((combo) => {
      const btn = document.createElement('button');
      btn.className = 'combo-btn';
      btn.textContent = `${combo.nombre} — $${combo.precio}`;
      btn.addEventListener('click', () => agregarComboAlCarrito(combo, feriaProductos, feria, container));
      combosRow.appendChild(btn);
    });
    container.appendChild(combosRow);
  }

  const grid = document.createElement('div');
  grid.className = 'productos-grid';
  feriaProductos.forEach((fp) => {
    const p = fp.productos;
    const precio = precioEfectivo(fp);
    const disponible = p.stock - cantidadEnCarrito(p.id);
    const card = document.createElement('button');
    card.className = 'producto-card';
    card.disabled = disponible <= 0 || precio == null;
    card.innerHTML = `
      ${p.imagen_url ? `<img src="${p.imagen_url}" alt="${p.nombre}" />` : '<div class="producto-card__sin-foto">🌸</div>'}
      <span class="producto-card__nombre">${p.nombre}</span>
      <span class="producto-card__precio">${precio != null ? `$${precio}` : 'sin precio'}</span>
      <span class="producto-card__stock">${disponible > 0 ? `Disponible: ${disponible}` : 'Sin stock'}</span>
    `;
    card.addEventListener('click', () => agregarProductoAlCarrito(p, precio, feria, container));
    grid.appendChild(card);
  });
  container.appendChild(grid);

  container.appendChild(renderCarrito(feria, container));
}

function agregarProductoAlCarrito(producto, precio, feria, container) {
  const disponible = producto.stock - cantidadEnCarrito(producto.id);
  if (disponible <= 0) {
    toast('No queda más stock disponible de ese producto');
    return;
  }
  const linea = carrito.find((l) => l.tipo === 'producto' && l.productoId === producto.id);
  if (linea) linea.cantidad += 1;
  else carrito.push({ tipo: 'producto', productoId: producto.id, nombre: producto.nombre, precio, cantidad: 1 });
  refrescarCarrito(feria, container);
}

function refrescarCarrito(feria, container) {
  const viejo = container.querySelector('#carrito-panel');
  const nuevo = renderCarrito(feria, container);
  if (viejo) viejo.replaceWith(nuevo);
  loadAndRender(feria, container); // recalcula "disponible" de cada card contra el carrito actualizado
}

function renderCarrito(feria, container) {
  const panel = document.createElement('div');
  panel.id = 'carrito-panel';
  panel.className = 'carrito-panel';

  const total = carrito.reduce((sum, l) => sum + l.precio * (l.tipo === 'producto' ? l.cantidad : 1), 0);

  panel.innerHTML = `
    <h3>🛒 Carrito</h3>
    <div class="carrito-lineas">
      ${carrito.map((l, i) => `
        <div class="carrito-linea" data-index="${i}">
          <span>${l.tipo === 'producto' ? `${l.nombre} x${l.cantidad}` : l.nombre} — $${l.precio * (l.tipo === 'producto' ? l.cantidad : 1)}</span>
          <button class="btn-icon" data-action="quitar-linea" data-index="${i}">🗑️</button>
        </div>
      `).join('') || '<p class="inv-empty">Carrito vacío</p>'}
    </div>
    <p class="carrito-total">Total: $${total}</p>
    <div class="carrito-actions">
      <button class="btn btn--secondary" id="btn-vaciar-carrito" ${carrito.length === 0 ? 'disabled' : ''}>Vaciar</button>
      <button class="btn" id="btn-confirmar-venta" ${carrito.length === 0 ? 'disabled' : ''}>Confirmar venta</button>
    </div>
  `;

  panel.querySelectorAll('[data-action="quitar-linea"]').forEach((btn) => {
    btn.addEventListener('click', () => {
      carrito.splice(Number(btn.dataset.index), 1);
      refrescarCarrito(feria, container);
    });
  });

  panel.querySelector('#btn-vaciar-carrito').addEventListener('click', () => {
    carrito = [];
    refrescarCarrito(feria, container);
  });

  return panel;
}

async function agregarComboAlCarrito(combo, feriaProductos, feria, container) {
  const disponibles = feriaProductos
    .map((fp) => fp.productos)
    .filter((p) => p.stock - cantidadEnCarrito(p.id) > 0);

  if (disponibles.length < combo.cantidad) {
    toast(`No hay suficientes productos con stock para este combo (necesita ${combo.cantidad})`);
    return;
  }

  const seleccionados = await seleccionarProductosCombo(combo, disponibles);
  if (!seleccionados) return;

  carrito.push({ tipo: 'combo', comboId: combo.id, nombre: combo.nombre, precio: combo.precio, productos: seleccionados });
  refrescarCarrito(feria, container);
}

function seleccionarProductosCombo(combo, disponibles) {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    const seleccion = new Set();

    function render() {
      overlay.innerHTML = `
        <div class="modal modal--combo">
          <p>Elegí ${combo.cantidad} productos para "${combo.nombre}" (${seleccion.size}/${combo.cantidad})</p>
          <div class="combo-picker-grid">
            ${disponibles.map((p) => `
              <button class="combo-picker-item ${seleccion.has(p.id) ? 'selected' : ''}" data-id="${p.id}">${p.nombre}</button>
            `).join('')}
          </div>
          <div class="modal-actions">
            <button class="btn btn--secondary" data-action="cancelar">Cancelar</button>
            <button class="btn" data-action="confirmar" ${seleccion.size !== combo.cantidad ? 'disabled' : ''}>Confirmar</button>
          </div>
        </div>
      `;
    }

    render();
    document.body.appendChild(overlay);

    overlay.addEventListener('click', (e) => {
      const id = e.target.dataset.id;
      if (id) {
        if (seleccion.has(id)) seleccion.delete(id);
        else if (seleccion.size < combo.cantidad) seleccion.add(id);
        render();
        return;
      }
      const action = e.target.dataset.action;
      if (action === 'cancelar') {
        document.body.removeChild(overlay);
        resolve(null);
      } else if (action === 'confirmar' && seleccion.size === combo.cantidad) {
        document.body.removeChild(overlay);
        resolve(disponibles.filter((p) => seleccion.has(p.id)).map((p) => ({ id: p.id, nombre: p.nombre })));
      }
    });
  });
}
```

- [ ] **Step 2: Agregar estilos de Vender/carrito a `styles.css`**

```css
.combos-row { display: flex; gap: 8px; overflow-x: auto; margin-bottom: 12px; }
.combo-btn { white-space: nowrap; }
.productos-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(120px, 1fr)); gap: 10px; margin-bottom: 100px; }
.producto-card { background: white; border-radius: var(--radius); padding: 10px; display: flex; flex-direction: column; align-items: center; gap: 4px; box-shadow: var(--shadow); }
.producto-card:disabled { opacity: 0.4; }
.producto-card img { width: 100%; height: 80px; object-fit: cover; border-radius: 8px; }
.producto-card__sin-foto { font-size: 2rem; }
.producto-card__nombre { font-weight: 600; font-size: 0.9rem; text-align: center; }
.producto-card__precio { color: var(--accent); font-weight: 700; }
.producto-card__stock { font-size: 0.75rem; opacity: 0.7; }

.carrito-panel {
  position: fixed; bottom: 0; left: 0; right: 0;
  background: white; border-radius: var(--radius) var(--radius) 0 0;
  box-shadow: 0 -4px 12px rgba(0,0,0,0.15);
  padding: 12px 16px; max-height: 40vh; overflow-y: auto;
}
.carrito-linea { display: flex; justify-content: space-between; padding: 4px 0; }
.carrito-total { font-weight: 700; font-size: 1.1rem; }
.carrito-actions { display: flex; gap: 8px; }
.combo-picker-grid { display: flex; flex-wrap: wrap; gap: 6px; margin: 12px 0; max-height: 200px; overflow-y: auto; }
.combo-picker-item { background: white; color: var(--text); border: 2px solid #f3d5e2; box-shadow: none; }
.combo-picker-item.selected { background: var(--accent); color: white; border-color: var(--accent); }
```

- [ ] **Step 3: Verificación manual**

Ir a Vender en una feria con al menos un producto con precio y stock. Tocarlo dos veces → el carrito debe mostrar "Nombre x2" con el subtotal correcto y el total actualizado. Tocar 🗑️ en esa línea → se quita del carrito. Si hay un combo activo, tocarlo → debe abrir el selector, elegir la cantidad requerida → "Confirmar" se habilita solo cuando la cuenta es exacta → confirmar → aparece como línea en el carrito. Tocar "Vaciar" → el carrito queda vacío y el total en $0. Verificar que el stock mostrado en las tarjetas de producto baja mientras hay unidades en el carrito (sin haber confirmado nada todavía) — eso confirma que el cálculo de "disponible" resta lo que ya está en el carrito.

- [ ] **Step 4: Commit**

```bash
git add js/vender.js styles.css
git commit -m "Add cart building to Vender tab (products and combos)"
```

---

### Task 12: Vender — confirmar venta (RPC) + confetti

**Files:**
- Modify: `js/vender.js`

**Interfaces:**
- Consumes: RPC `confirmar_venta` (Tarea 2), `confirmDialog`/`toast` (Tarea 5), `confetti` (global, cargado por `<script>` CDN en `index.html`).

- [ ] **Step 1: Agregar el import de `confirmDialog` en `js/vender.js`**

Cambiar la línea de import existente:

```js
import { toast } from './ui.js';
```

por:

```js
import { confirmDialog, toast } from './ui.js';
```

- [ ] **Step 2: Agregar el handler de confirmar venta en `renderCarrito`**

Dentro de `renderCarrito`, después del bloque `panel.querySelector('#btn-vaciar-carrito').addEventListener(...)`, agregar:

```js
  panel.querySelector('#btn-confirmar-venta').addEventListener('click', async () => {
    if (!navigator.onLine) {
      toast('Sin conexión — no se puede confirmar la venta ahora');
      return;
    }

    const total = carrito.reduce((sum, l) => sum + l.precio * (l.tipo === 'producto' ? l.cantidad : 1), 0);
    const ok = await confirmDialog(`¿Confirmar venta por un total de $${total}?`);
    if (!ok) return;

    const items = carrito.map((l) => l.tipo === 'producto'
      ? { tipo: 'producto', producto_id: l.productoId, cantidad: l.cantidad }
      : { tipo: 'combo', combo_id: l.comboId, producto_ids: l.productos.map((p) => p.id) }
    );

    const { data, error } = await supabase.rpc('confirmar_venta', { p_feria_id: feria.id, p_items: items });

    if (error) {
      toast(`No se pudo confirmar la venta: ${error.message}`);
      return;
    }

    carrito = [];
    if (window.confetti) window.confetti({ particleCount: 120, spread: 80, origin: { y: 0.7 } });
    toast(`¡Venta registrada! 🎉 Total: $${data[0].total}`);
    loadAndRender(feria, container);
  });
```

- [ ] **Step 3: Verificación manual**

Con un producto con stock ≥ 2, agregar 2 unidades al carrito → "Confirmar venta" → confirmar en el diálogo → debe verse confetti en pantalla, un toast "¡Venta registrada!" con el total correcto, el carrito vaciarse, y el stock del producto bajar en 2 en la grilla. Ir a Supabase SQL Editor y correr `select * from ventas order by created_at desc limit 1;` y `select * from venta_items order by created_at desc limit 5;` → deben reflejar la venta con el total y las líneas correctas. Repetir vaciando el stock de un producto a 0 desde otra pestaña justo antes de confirmar (para simular condición de carrera) → debe mostrar el mensaje de error de la función y NO debe aparecer confetti ni vaciarse el carrito con una venta a medias.

- [ ] **Step 4: Commit**

```bash
git add js/vender.js
git commit -m "Wire cart checkout to confirmar_venta RPC with confetti on success"
```

---

### Task 13: Ideas

**Files:**
- Modify: `js/ideas.js`

**Interfaces:**
- Consumes: `supabase`, `confirmDialog`.

- [ ] **Step 1: Reemplazar `js/ideas.js`**

```js
import { supabase } from './supabaseClient.js';
import { confirmDialog } from './ui.js';

const TIPOS = { producto: '💡 Producto', logistica: '📋 Logística', precio: '💰 Precio/Promo' };

export function initIdeas(feria) {
  const container = document.getElementById('tab-ideas');
  container.innerHTML = '<p>Cargando ideas...</p>';
  render(feria, container, 'todos');
  return () => {};
}

async function render(feria, container, filtro) {
  const query = supabase.from('notas').select('*').eq('feria_id', feria.id).order('created_at', { ascending: false });
  const { data: notas } = filtro === 'todos' ? await query : await query.eq('tipo', filtro);

  container.innerHTML = `
    <div class="ideas-filtros">
      <button data-filtro="todos" class="${filtro === 'todos' ? 'active' : ''}">Todos</button>
      ${Object.entries(TIPOS).map(([key, label]) => `<button data-filtro="${key}" class="${filtro === key ? 'active' : ''}">${label}</button>`).join('')}
    </div>
    <div id="ideas-list" class="ideas-list">
      ${notas.map((n) => `
        <div class="idea-row ${n.hecho ? 'idea-row--hecho' : ''}" data-id="${n.id}">
          <input type="checkbox" data-action="toggle-hecho" data-id="${n.id}" ${n.hecho ? 'checked' : ''} />
          <span class="idea-tipo">${TIPOS[n.tipo]}</span>
          <span class="idea-texto">${n.texto}</span>
          <button class="btn-icon" data-action="eliminar-nota" data-id="${n.id}">🗑️</button>
        </div>
      `).join('') || '<p class="inv-empty">Sin notas todavía</p>'}
    </div>
    <form id="form-nota" class="inv-form">
      <select name="tipo">
        ${Object.entries(TIPOS).map(([key, label]) => `<option value="${key}">${label}</option>`).join('')}
      </select>
      <input name="texto" placeholder="Escribí tu idea..." required />
      <button type="submit">Agregar</button>
    </form>
  `;

  container.querySelectorAll('[data-filtro]').forEach((btn) => {
    btn.addEventListener('click', () => render(feria, container, btn.dataset.filtro));
  });

  container.querySelectorAll('[data-action="toggle-hecho"]').forEach((cb) => {
    cb.addEventListener('change', async () => {
      await supabase.from('notas').update({ hecho: cb.checked }).eq('id', cb.dataset.id);
    });
  });

  container.querySelectorAll('[data-action="eliminar-nota"]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const ok = await confirmDialog('¿Eliminar esta nota?');
      if (!ok) return;
      await supabase.from('notas').delete().eq('id', btn.dataset.id);
      render(feria, container, filtro);
    });
  });

  container.querySelector('#form-nota').addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.target;
    await supabase.from('notas').insert({ feria_id: feria.id, tipo: form.tipo.value, texto: form.texto.value.trim() });
    render(feria, container, filtro);
  });
}
```

- [ ] **Step 2: Agregar estilos de ideas a `styles.css`**

```css
.ideas-filtros { display: flex; gap: 6px; overflow-x: auto; margin-bottom: 12px; }
.ideas-filtros button { background: white; color: var(--text); box-shadow: none; opacity: 0.6; white-space: nowrap; }
.ideas-filtros button.active { background: var(--accent); color: white; opacity: 1; }
.idea-row { display: flex; align-items: center; gap: 8px; background: white; border-radius: var(--radius); padding: 10px; margin-bottom: 6px; }
.idea-row--hecho .idea-texto { text-decoration: line-through; opacity: 0.5; }
.idea-tipo { font-size: 0.8rem; white-space: nowrap; }
.idea-texto { flex: 1; }
```

- [ ] **Step 3: Verificación manual**

En la pestaña Ideas, agregar una nota de cada tipo (producto/logística/precio). Filtrar por "📋 Logística" → debe mostrar solo esa. Marcar el checkbox de una → el texto debe tacharse. Recargar → el estado tachado debe persistir. Eliminar una nota → pide confirmación y desaparece.

- [ ] **Step 4: Commit**

```bash
git add js/ideas.js styles.css
git commit -m "Add Ideas tab with typed, filterable notes"
```

---

### Task 14: Reportes por feria

**Files:**
- Modify: `js/reportes.js`

**Interfaces:**
- Consumes: `ventas`, `venta_items`, `venta_item_combo_productos` de la feria actual.

- [ ] **Step 1: Reemplazar `js/reportes.js`**

```js
import { supabase } from './supabaseClient.js';

export function initReportes(feria) {
  const container = document.getElementById('tab-reportes');
  container.innerHTML = '<p>Cargando reportes...</p>';
  render(feria, container);
  return () => {};
}

async function render(feria, container) {
  const { data: ventas, error: ventasError } = await supabase
    .from('ventas').select('*').eq('feria_id', feria.id).order('created_at', { ascending: false });

  const { data: items, error: itemsError } = await supabase
    .from('venta_items')
    .select('*, ventas!inner(feria_id)')
    .eq('ventas.feria_id', feria.id);

  const { data: comboItems } = await supabase
    .from('venta_item_combo_productos')
    .select('producto_nombre, venta_items!inner(venta_id, ventas!inner(feria_id))')
    .eq('venta_items.ventas.feria_id', feria.id);

  if (ventasError || itemsError) {
    container.innerHTML = '<p class="error">No se pudo cargar el reporte</p>';
    return;
  }

  container.innerHTML = `
    <section class="inv-section">
      <h2>Por fecha</h2>
      <div id="reporte-fechas"></div>
    </section>
    <section class="inv-section">
      <h2>Productos más vendidos</h2>
      <div id="reporte-top-productos"></div>
    </section>
    <section class="inv-section">
      <h2>Por categoría de precio</h2>
      <div id="reporte-categorias"></div>
    </section>
  `;

  renderPorFecha(ventas, container.querySelector('#reporte-fechas'));
  renderTopProductos(items, comboItems || [], container.querySelector('#reporte-top-productos'));
  renderPorCategoria(items, container.querySelector('#reporte-categorias'));
}

function renderPorFecha(ventas, el) {
  const hoy = new Date().toISOString().slice(0, 10);
  const porFecha = {};
  ventas.forEach((v) => {
    const fecha = v.created_at.slice(0, 10);
    if (!porFecha[fecha]) porFecha[fecha] = { total: 0, cantidad: 0 };
    porFecha[fecha].total += Number(v.total);
    porFecha[fecha].cantidad += 1;
  });
  const fechas = Object.keys(porFecha).sort().reverse();
  el.innerHTML = fechas.map((fecha) => {
    const r = porFecha[fecha];
    const esHoy = fecha === hoy;
    return `<details class="historial-dia" ${esHoy ? 'open' : ''}>
      <summary>${esHoy ? '⭐ Hoy' : fecha} — $${r.total} (${r.cantidad} ventas)</summary>
    </details>`;
  }).join('') || '<p class="inv-empty">Todavía no hay ventas</p>';
}

function renderTopProductos(items, comboItems, el) {
  const conteo = {};
  items.filter((i) => i.tipo === 'producto').forEach((i) => {
    conteo[i.producto_nombre] = (conteo[i.producto_nombre] || 0) + i.cantidad;
  });
  comboItems.forEach((ci) => {
    conteo[ci.producto_nombre] = (conteo[ci.producto_nombre] || 0) + 1;
  });
  const ranking = Object.entries(conteo).sort((a, b) => b[1] - a[1]).slice(0, 10);
  el.innerHTML = ranking.map(([nombre, cant]) => `<div class="inv-row"><span>${nombre}</span><span>${cant} vendidos</span></div>`).join('')
    || '<p class="inv-empty">Todavía no hay ventas</p>';
}

function renderPorCategoria(items, el) {
  const porCategoria = {};
  items.forEach((i) => {
    const clave = i.tipo === 'combo' ? 'Combos' : (i.categoria_precio_nombre || 'Sin categoría');
    porCategoria[clave] = (porCategoria[clave] || 0) + i.precio_unitario * i.cantidad;
  });
  el.innerHTML = Object.entries(porCategoria).map(([nombre, total]) => `<div class="inv-row"><span>${nombre}</span><span>$${total}</span></div>`).join('')
    || '<p class="inv-empty">Todavía no hay ventas</p>';
}
```

- [ ] **Step 2: Verificación manual**

Después de confirmar un par de ventas en la Tarea 12, entrar a la pestaña Reportes de esa feria. "Por fecha" debe mostrar "⭐ Hoy" con el total y cantidad correctos. "Productos más vendidos" debe listar los productos vendidos con su conteo (sumando también los que entraron dentro de combos). "Por categoría de precio" debe mostrar el total agrupado por cada categoría usada, y una fila "Combos" si se vendió algún combo.

- [ ] **Step 3: Commit**

```bash
git add js/reportes.js
git commit -m "Add per-fair reports: by date, top products, by price category"
```

---

### Task 15: Reporte general (comparativa entre ferias)

**Files:**
- Create: `js/reporte-general.js`
- Modify: `js/app.js`

**Interfaces:**
- Produces: `initReporteGeneral({ onVolver: () => void })` — muestra `#reporte-general`, pinta la comparativa, wire del botón volver.

- [ ] **Step 1: Crear `js/reporte-general.js`**

```js
import { supabase } from './supabaseClient.js';

export async function initReporteGeneral({ onVolver }) {
  const screen = document.getElementById('reporte-general');
  const content = document.getElementById('reporte-general-content');
  screen.classList.remove('hidden');
  content.innerHTML = '<p>Cargando...</p>';

  document.getElementById('btn-volver-selector').onclick = () => {
    screen.classList.add('hidden');
    onVolver();
  };

  const { data: ferias } = await supabase.from('ferias').select('*').order('nombre');
  const { data: ventas } = await supabase.from('ventas').select('feria_id, total');

  const porFeria = {};
  (ferias || []).forEach((f) => { porFeria[f.id] = { feria: f, total: 0, cantidad: 0 }; });
  (ventas || []).forEach((v) => {
    if (!porFeria[v.feria_id]) return;
    porFeria[v.feria_id].total += Number(v.total);
    porFeria[v.feria_id].cantidad += 1;
  });

  const totalGeneral = Object.values(porFeria).reduce((sum, r) => sum + r.total, 0);
  const cantidadGeneral = Object.values(porFeria).reduce((sum, r) => sum + r.cantidad, 0);

  content.innerHTML = `
    <section class="inv-section">
      <h2>Total combinado</h2>
      <p class="carrito-total">$${totalGeneral} — ${cantidadGeneral} ventas</p>
    </section>
    <section class="inv-section">
      <h2>Por feria</h2>
      ${Object.values(porFeria).map((r) => `
        <div class="inv-row">
          <span>${r.feria.emoji} ${r.feria.nombre}</span>
          <span>$${r.total} (${r.cantidad} ventas)</span>
        </div>
      `).join('') || '<p class="inv-empty">Todavía no hay ferias</p>'}
    </section>
  `;
}
```

- [ ] **Step 2: Modificar `js/app.js`**

Agregar el import y el wiring del botón. Reemplazar el contenido completo por:

```js
import { initAuth } from './auth.js';
import { initFeriaSelector } from './ferias.js';
import { initFeriaView } from './nav.js';
import { initReporteGeneral } from './reporte-general.js';

function showFeriaSelector() {
  document.getElementById('feria-view').classList.add('hidden');
  document.getElementById('reporte-general').classList.add('hidden');
  initFeriaSelector((feria) => {
    initFeriaView(feria, { onExit: showFeriaSelector });
  });
}

document.getElementById('btn-reporte-general').addEventListener('click', () => {
  document.getElementById('feria-selector').classList.add('hidden');
  initReporteGeneral({ onVolver: showFeriaSelector });
});

initAuth(showFeriaSelector);
```

- [ ] **Step 3: Verificación manual**

Desde el selector de ferias, clickear "📊 Reporte general" → debe verse el total combinado y una fila por feria con su total y cantidad de ventas (coincidiendo con lo visto en Reportes de cada feria individual). Clickear "← Volver" → vuelve al selector.

- [ ] **Step 4: Commit**

```bash
git add js/reporte-general.js js/app.js
git commit -m "Add cross-fair general report"
```

---

### Task 16: Estado de conexión

**Files:**
- Create: `js/connection.js`
- Modify: `js/app.js`

**Interfaces:**
- Produces: `initConnectionBanner(): void` — pinta el banner de conexión. `js/vender.js` (Tarea 12) ya usa `navigator.onLine` directamente para bloquear la confirmación de venta sin conexión, así que no depende de este archivo; `isOnline()` queda exportado como utilidad reusable si algún otro módulo la necesita más adelante.

- [ ] **Step 1: Crear `js/connection.js`**

```js
export function initConnectionBanner() {
  const banner = document.getElementById('connection-banner');

  function update() {
    banner.classList.toggle('hidden', navigator.onLine);
  }

  window.addEventListener('online', update);
  window.addEventListener('offline', update);
  update();
}

export function isOnline() {
  return navigator.onLine;
}
```

- [ ] **Step 2: Modificar `js/app.js`**

Agregar el import y la llamada. Reemplazar el contenido completo por:

```js
import { initAuth } from './auth.js';
import { initFeriaSelector } from './ferias.js';
import { initFeriaView } from './nav.js';
import { initReporteGeneral } from './reporte-general.js';
import { initConnectionBanner } from './connection.js';

function showFeriaSelector() {
  document.getElementById('feria-view').classList.add('hidden');
  document.getElementById('reporte-general').classList.add('hidden');
  initFeriaSelector((feria) => {
    initFeriaView(feria, { onExit: showFeriaSelector });
  });
}

document.getElementById('btn-reporte-general').addEventListener('click', () => {
  document.getElementById('feria-selector').classList.add('hidden');
  initReporteGeneral({ onVolver: showFeriaSelector });
});

initConnectionBanner();
initAuth(showFeriaSelector);
```

- [ ] **Step 3: Verificación manual**

Con la app abierta, en devtools → Network → marcar "Offline" → debe aparecer el banner "📡 Sin conexión...". Ir a Vender, agregar algo al carrito y tocar "Confirmar venta" → debe mostrar el toast "Sin conexión — no se puede confirmar la venta ahora" sin llegar a llamar al RPC. Volver a marcar "Online" en devtools → el banner desaparece.

- [ ] **Step 4: Commit**

```bash
git add js/connection.js js/app.js
git commit -m "Add offline banner and guard against confirming sales while offline"
```

---

### Task 17: Diseño visual final

**Files:**
- Modify: `styles.css`

**Interfaces:** Ninguna — solo estilos, no cambia comportamiento.

- [ ] **Step 1: Revisar y pulir `styles.css`**

Agregar al final del archivo (breakpoint responsive para desktop, y detalles finales):

```css
@media (min-width: 700px) {
  .screen { max-width: 700px; margin: 0 auto; }
  .productos-grid { grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); }
  .carrito-panel { max-width: 700px; left: 50%; transform: translateX(-50%); border-radius: var(--radius); margin-bottom: 16px; position: sticky; bottom: 16px; }
}

h1, h2 { color: var(--text); }
.pin-card { background: white; border-radius: var(--radius); padding: 24px; text-align: center; max-width: 340px; margin: 40px auto; box-shadow: var(--shadow); }
.pin-card form { display: flex; flex-direction: column; gap: 10px; margin-top: 16px; }
.pin-card input { padding: 10px; border-radius: 8px; border: 1px solid #f3d5e2; font-family: inherit; text-align: center; }

.banner { padding: 8px 16px; text-align: center; font-size: 0.9rem; }
.banner--offline { background: #ffe0a3; color: #7a5600; }

.inv-row__foto { width: 36px; height: 36px; object-fit: cover; border-radius: 8px; }
.inv-hint { font-size: 0.85rem; opacity: 0.7; margin-top: -8px; }
```

- [ ] **Step 2: Verificación manual**

Abrir la app en devtools con el viewport en modo móvil (ej. iPhone SE, 375px) → todo debe verse sin scroll horizontal, el carrito debe quedar fijo abajo, las tarjetas de producto deben caber cómodamente. Cambiar el viewport a desktop (ej. 1200px) → el contenido debe quedar centrado con un ancho máximo razonable, no estirado a todo el ancho de la pantalla.

- [ ] **Step 3: Commit**

```bash
git add styles.css
git commit -m "Polish visual design: responsive breakpoint and final styling pass"
```

---

### Task 18: Script de import de stickers existentes

**Files:**
- Create: `scripts/package.json`
- Create: `scripts/import-stickers.mjs`

**Interfaces:**
- Produces: script ejecutable una sola vez, no forma parte de la app servida.

- [ ] **Step 1: Crear `scripts/package.json`**

```json
{
  "name": "feria-sofy-scripts",
  "private": true,
  "type": "module",
  "dependencies": {
    "@supabase/supabase-js": "^2.45.0",
    "exceljs": "^4.4.0"
  }
}
```

- [ ] **Step 2: Crear `scripts/import-stickers.mjs`**

```js
// Uso: SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/import-stickers.mjs
// Corre desde la raíz del repo (lee insumos/Inventario stickers.xlsx con ruta relativa).

import ExcelJS from 'exceljs';
import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';
import path from 'node:path';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error('Faltan SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY en el entorno');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
const BUCKET = 'productos-fotos';

async function main() {
  const { data: feria, error: feriaError } = await supabase
    .from('ferias').select('id').eq('slug', 'stickers').single();

  if (feriaError || !feria) {
    console.error('No se encontró la feria "stickers". Corré primero sql/seed.sql.');
    process.exit(1);
  }

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(path.resolve('insumos/Inventario stickers.xlsx'));
  const sheet = workbook.worksheets[0];
  const images = sheet.getImages();

  let creados = 0;
  for (let rowNumber = 4; rowNumber <= sheet.rowCount; rowNumber++) {
    const row = sheet.getRow(rowNumber);
    const nombre = row.getCell(3).value; // columna C: Nombre
    const cantidad = row.getCell(4).value; // columna D: Cantidad

    if (!nombre) continue;

    let imagenUrl = null;
    const imagen = images.find((img) => img.range.tl.row <= rowNumber - 1 && img.range.br.row >= rowNumber - 1);
    if (imagen) {
      const img = workbook.getImage(imagen.imageId);
      const fileName = `${randomUUID()}.${img.extension}`;
      const { error: uploadError } = await supabase.storage
        .from(BUCKET)
        .upload(fileName, Buffer.from(img.buffer), { contentType: `image/${img.extension}` });

      if (!uploadError) {
        imagenUrl = supabase.storage.from(BUCKET).getPublicUrl(fileName).data.publicUrl;
      } else {
        console.warn(`No se pudo subir la foto de "${nombre}":`, uploadError.message);
      }
    }

    const { data: producto, error: insertError } = await supabase
      .from('productos')
      .insert({ nombre: String(nombre).trim(), stock: Number(cantidad) || 0, imagen_url: imagenUrl })
      .select()
      .single();

    if (insertError) {
      console.warn(`No se pudo crear el producto "${nombre}":`, insertError.message);
      continue;
    }

    await supabase.from('feria_productos').insert({ feria_id: feria.id, producto_id: producto.id });

    creados++;
    console.log(`✓ ${nombre} (stock: ${cantidad})`);
  }

  console.log(`\nListo: ${creados} productos creados.`);
}

main();
```

- [ ] **Step 3: Correr el script**

```bash
cd scripts
npm install
cd ..
SUPABASE_URL="https://YOUR-PROJECT.supabase.co" SUPABASE_SERVICE_ROLE_KEY="<service-role-key>" node scripts/import-stickers.mjs
```

(En PowerShell, usar `$env:SUPABASE_URL="..."; $env:SUPABASE_SERVICE_ROLE_KEY="..."; node scripts/import-stickers.mjs` en vez de la sintaxis de una línea.)

- [ ] **Step 4: Verificación manual**

Debe imprimirse una línea `✓ <nombre> (stock: <cantidad>)` por cada uno de los 53 diseños, terminando en "Listo: 53 productos creados." (o menos si alguno falla — revisar los `console.warn` si los hay). En el SQL Editor de Supabase, correr `select count(*) from feria_productos fp join ferias f on f.id = fp.feria_id where f.slug = 'stickers';` → debe dar 53 (o el número reportado). Abrir la app, ir a la feria de Stickers → Inventario → deben verse los 53 productos con sus fotos y stock. Elegir 3-4 al azar y comparar su foto contra la fila correspondiente en `insumos/Inventario stickers.xlsx` para confirmar que el emparejamiento imagen↔fila fue correcto (el `range.tl.row`/`br.row` de exceljs puede desalinearse en casos raros — si alguno está mal emparejado, corregir la foto a mano desde Inventario).

- [ ] **Step 5: Commit**

```bash
git add scripts/package.json scripts/import-stickers.mjs
git commit -m "Add one-time import script for existing sticker inventory"
```

(No commitear `scripts/node_modules/` — agregar `scripts/node_modules/` a `.gitignore` si no está ya cubierto por un patrón existente.)

---

### Task 19: Deploy a GitHub Pages

**Files:**
- Modify: `.gitignore` (si hace falta agregar `scripts/node_modules/`)

**Interfaces:** Ninguna — despliegue, no código de la app.

- [ ] **Step 1: Verificar `.gitignore`**

Confirmar que incluye `scripts/node_modules/` (agregarlo si el Step 5 de la Tarea 18 no lo hizo ya).

- [ ] **Step 2: Crear el repo en GitHub y pushear**

```bash
git remote add origin https://github.com/<tu-usuario>/feria-de-sofy.git
git push -u origin master
```

(Reemplazar `<tu-usuario>` y el nombre del repo según corresponda; crear el repo vacío en GitHub primero si no existe.)

- [ ] **Step 3: Habilitar GitHub Pages**

En GitHub → el repo → Settings → Pages → Source: "Deploy from a branch" → Branch: `master` / `/ (root)` → Save. Esperar 1-2 minutos.

- [ ] **Step 4: Agregar la URL de producción a Supabase**

Copiar la URL que GitHub Pages asigna (ej. `https://<tu-usuario>.github.io/feria-de-sofy/`). En Supabase dashboard → Authentication → URL Configuration → agregar esa URL a **Redirect URLs** (además de `http://localhost:8000` de la Tarea 1).

- [ ] **Step 5: Verificación manual**

Abrir la URL de GitHub Pages desde el celular. Debe verse la pantalla de login. Loguearse con el correo invitado, recibir el link mágico, clickearlo desde el celular → debe volver a la app ya logueado. Repetir el flujo completo (elegir feria → vender algo → ver que aparece en reportes) desde el celular para confirmar que todo funciona igual que en local.

- [ ] **Step 6: Commit (si hubo cambios en `.gitignore`)**

```bash
git add .gitignore
git commit -m "Ignore scripts/node_modules"
git push
```
