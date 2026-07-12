# Feria de Sofy v2 — "Que la caja cuadre" — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convertir la v1 (POS atómico que solo suma ingresos) en una herramienta que cuadra la caja del día: registra cómo se pagó, snapshotea el costo, permite descuento y anular ventas, acelera el cobro, y deja la función del dinero tocada una sola vez.

**Architecture:** Se mantiene el stack de v1 (HTML/CSS/JS vanilla, módulos ES sin build, Supabase). El núcleo es una **única migración de schema** más una **reescritura de `confirmar_venta`** que agrega en un solo paso: método de pago, snapshot de costo, descuento, idempotencia (`client_venta_id`) y líneas de monto libre; más una RPC inversa `anular_venta` con soft-delete. El frontend se cablea a la nueva firma, se agrega cierre de caja, se acelera el cobro y se pone un piso de confiabilidad barato.

**Tech Stack:** HTML5, CSS3, JavaScript (ES2022 modules), Supabase JS client v2 (CDN, `https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm`), Supabase (Postgres/Auth/Storage/Realtime), canvas-confetti (CDN), GitHub Pages. Sin framework, sin build step.

## Global Constraints

- **No build step:** módulos ES nativos vía `<script type="module">`, imports CDN con `+esm`.
- **Sin framework de test JS** (decisión YAGNI heredada de v1): las tareas de frontend terminan con un procedimiento de **verificación manual** (clicks/inputs exactos y resultado esperado). Las tareas de backend (SQL) terminan con **tests de integración SQL** que se corren en el **Supabase SQL Editor**.
- **Servidor local para ES modules:** cada verificación de frontend asume `python -m http.server 8000` corriendo desde la raíz y la app abierta en `http://localhost:8000`.
- **Tocar la función del dinero UNA sola vez:** `confirmar_venta` / `venta_items` / `ventas` se migran en un solo release (Tareas 1-4). No dispersar la migración.
- **No romper la atomicidad:** toda escritura que afecte stock corre dentro de una transacción de Postgres (RPC), con `UPDATE … WHERE stock >= N`. Nunca escrituras secuenciales desde el cliente para el checkout.
- **Snapshot desde el día 1:** el costo y el método de pago se congelan en la venta al momento de vender; el histórico no se reconstruye.
- **Nunca DELETE de ventas:** las ventas se anulan con soft-delete (`anulada=true`), nunca se borran.
- **Enum de método de pago:** exactamente `'efectivo' | 'transferencia' | 'otro'` (QR entra en "otro"; no hay tarjeta).
- **Paleta Toki:** `--accent: #E0703F`, `--bg: #FBDFC5`, `--text: #5C3A26`. Fuente Quicksand. Bordes redondeados (`--radius: 16px`).
- **Convención de test SQL:** cada test es un bloque `do $$ … end $$;` que arma datos de prueba, corre `assert cond, 'mensaje'`, y al final ejecuta `raise exception 'ROLLBACK_OK';` para deshacer todos sus cambios. **El test pasó si el SQL Editor muestra el error `ROLLBACK_OK`.** Cualquier otro mensaje = una assertion falló (test rojo). Ningún test deja datos en la base.
- **Repo root:** `C:\Users\luis\Desktop\Sofi Feria` (git repo; v1 en producción en https://luismgo.github.io/feria-de-sofy/). Definición de la v2: `docs/superpowers/specs/2026-07-11-feria-de-sofy-v2-definicion.md` — leerla si hace falta el rationale.
- Las migraciones y funciones SQL se aplican en el **único proyecto Supabase de producción** (`feria-de-sofy`) vía SQL Editor. La migración es **aditiva** (columnas nuevas con default), segura sobre datos existentes.

## File Structure

- `sql/tests/confirmar_venta_baseline.sql` — **Crear.** Test de caracterización del `confirmar_venta` actual (red de seguridad antes de tocarlo).
- `sql/migrations/2026-07-11-v2-money.sql` — **Crear.** Migración única: columnas de costo, pago, descuento, idempotencia, anulación, línea manual.
- `sql/rpc_confirmar_venta.sql` — **Modificar.** Reescritura a la nueva firma.
- `sql/tests/confirmar_venta_v2.sql` — **Crear.** Tests de la nueva firma (pago, descuento, costo snapshot, idempotencia, manual).
- `sql/rpc_anular_venta.sql` — **Crear.** RPC inversa + soft-delete.
- `sql/tests/anular_venta.sql` — **Crear.** Tests de reposición de stock/insumos y flags.
- `js/vender.js` — **Modificar.** Método de pago, idempotencia, timeout/abort, descuento, buscador/orden, precio al vuelo, dejar de refetchear, quitar el confirm.
- `js/inventario.js` — **Modificar.** Input de costo en productos.
- `js/insumos.js` — **Modificar.** Input de costo en insumos.
- `js/connection.js` — **Modificar.** Health-check real (ping) en vez de solo `navigator.onLine`.
- `js/ui.js` — **Modificar.** Helper `mutar()` que captura errores y muestra toast.
- `js/reportes.js` — **Modificar.** Filtrar anuladas; detalle por fecha; cierre de caja; ventas de hoy + anular.
- `js/reporte-general.js` — **Modificar.** Filtrar anuladas.
- `styles.css` — **Modificar.** Contraste AA, `button:disabled`, estilos de buscador/pago/cierre.

---

### Task 1: Red de seguridad — test de caracterización del `confirmar_venta` actual

**Files:**
- Create: `sql/tests/confirmar_venta_baseline.sql`

**Interfaces:**
- Consumes: `confirmar_venta(uuid, jsonb)` (versión v1 actual).
- Produces: un test SQL reutilizable que garantiza que el comportamiento base (venta de producto: total correcto, stock e insumo descontados, líneas insertadas) no se rompe cuando se reescriba la función en la Tarea 3.

- [ ] **Step 1: Escribir `sql/tests/confirmar_venta_baseline.sql`**

```sql
-- Test de caracterización del confirmar_venta v1. Corre en el Supabase SQL Editor.
-- PASA si el editor muestra el error 'ROLLBACK_OK'. Cualquier otro error = falla.
do $$
declare
  v_feria uuid;
  v_cat uuid;
  v_prod uuid;
  v_insumo uuid;
  v_res record;
  v_stock integer;
  v_stock_insumo integer;
  v_nitems integer;
begin
  -- setup
  insert into ferias (nombre, emoji, slug) values ('TEST feria', '🧪', 'test-baseline-feria') returning id into v_feria;
  insert into categorias_precio (feria_id, nombre, precio) values (v_feria, 'TestCat', 100) returning id into v_cat;
  insert into productos (nombre, stock) values ('TEST prod', 10) returning id into v_prod;
  insert into feria_productos (feria_id, producto_id, categoria_precio_id) values (v_feria, v_prod, v_cat);
  insert into insumos (nombre, stock) values ('TEST insumo', 20) returning id into v_insumo;
  insert into producto_insumos (producto_id, insumo_id, cantidad) values (v_prod, v_insumo, 2);

  -- ejercicio: vender 3 unidades
  select * into v_res from confirmar_venta(
    v_feria,
    format('[{"tipo":"producto","producto_id":"%s","cantidad":3}]', v_prod)::jsonb
  );

  -- asserts
  assert v_res.total = 300, format('total esperado 300, obtenido %s', v_res.total);
  select stock into v_stock from productos where id = v_prod;
  assert v_stock = 7, format('stock esperado 7, obtenido %s', v_stock);
  select stock into v_stock_insumo from insumos where id = v_insumo;
  assert v_stock_insumo = 14, format('insumo esperado 14 (20 - 2*3), obtenido %s', v_stock_insumo);
  select count(*) into v_nitems from venta_items where venta_id = v_res.venta_id;
  assert v_nitems = 1, format('venta_items esperado 1, obtenido %s', v_nitems);

  raise exception 'ROLLBACK_OK';
end $$;
```

- [ ] **Step 2: Correr el test contra la función actual**

Pegar el archivo completo en Supabase → SQL Editor → New query → Run.
Expected: el editor muestra el error `ERROR: ROLLBACK_OK`. Eso confirma que todas las assertions pasaron y que los datos de prueba se revirtieron (ninguna fila `TEST` queda en la base). Verificar además `select count(*) from ferias where slug = 'test-baseline-feria';` → debe devolver `0`.

- [ ] **Step 3: Commit**

```bash
git add sql/tests/confirmar_venta_baseline.sql
git commit -m "Add characterization test for confirmar_venta before v2 rewrite"
```

---

### Task 2: Migración única de schema (costo, pago, descuento, idempotencia, anulación, línea manual)

**Files:**
- Create: `sql/migrations/2026-07-11-v2-money.sql`

**Interfaces:**
- Consumes: tablas de v1 (`productos`, `insumos`, `ventas`, `venta_items`).
- Produces: columnas nuevas que consumen las Tareas 3, 4, 5, 11, 12, 13:
  - `productos.costo numeric` (default 0), `insumos.costo numeric` (default 0)
  - `ventas.metodo_pago text` (`efectivo|transferencia|otro`, default `efectivo`), `ventas.descuento numeric` (default 0), `ventas.client_venta_id uuid unique`, `ventas.anulada boolean` (default false), `ventas.anulada_at timestamptz`, `ventas.anulada_by uuid`, `ventas.motivo_anulacion text`
  - `venta_items.costo_unitario numeric` (nullable), `venta_items.tipo` check ampliado a `producto|combo|manual`

- [ ] **Step 1: Escribir `sql/migrations/2026-07-11-v2-money.sql`**

```sql
-- Migración v2 "que la caja cuadre". Aditiva e idempotente. Correr una vez en el SQL Editor.

-- Costo editable (para el snapshot del RPC)
alter table productos add column if not exists costo numeric not null default 0;
alter table insumos   add column if not exists costo numeric not null default 0;

-- Ventas: método de pago, descuento, idempotencia, soft-delete de anulación
alter table ventas add column if not exists metodo_pago text not null default 'efectivo';
alter table ventas add column if not exists descuento numeric not null default 0;
alter table ventas add column if not exists client_venta_id uuid;
alter table ventas add column if not exists anulada boolean not null default false;
alter table ventas add column if not exists anulada_at timestamptz;
alter table ventas add column if not exists anulada_by uuid;
alter table ventas add column if not exists motivo_anulacion text;

-- Constraints (con guarda para poder re-correr sin error)
do $$ begin
  alter table ventas add constraint ventas_metodo_pago_check check (metodo_pago in ('efectivo','transferencia','otro'));
exception when duplicate_object then null; end $$;

do $$ begin
  alter table ventas add constraint ventas_client_venta_id_key unique (client_venta_id);
exception when duplicate_table then null; when duplicate_object then null; end $$;

-- venta_items: snapshot de costo + tipo 'manual' (línea de monto libre)
alter table venta_items add column if not exists costo_unitario numeric;
alter table venta_items drop constraint if exists venta_items_tipo_check;
alter table venta_items add constraint venta_items_tipo_check check (tipo in ('producto','combo','manual'));
```

- [ ] **Step 2: Correr la migración**

Pegar el archivo completo en el SQL Editor → Run. Expected: `Success. No rows returned`.

- [ ] **Step 3: Verificar las columnas y que el baseline sigue verde**

Correr:
```sql
select column_name from information_schema.columns
  where table_name = 'ventas' and column_name in
  ('metodo_pago','descuento','client_venta_id','anulada','anulada_at','anulada_by','motivo_anulacion')
  order by column_name;
```
Expected: 7 filas. Correr también `select column_name from information_schema.columns where table_name='productos' and column_name='costo';` → 1 fila, y lo mismo para `insumos`.
Volver a correr `sql/tests/confirmar_venta_baseline.sql` → debe seguir mostrando `ROLLBACK_OK` (la migración aditiva no rompió el comportamiento actual).

- [ ] **Step 4: Commit**

```bash
git add sql/migrations/2026-07-11-v2-money.sql
git commit -m "Add v2 schema migration: cost, payment, discount, idempotency, soft-delete"
```

---

### Task 3: Reescribir `confirmar_venta` (pago + descuento + idempotencia + costo snapshot + línea manual)

**Files:**
- Modify: `sql/rpc_confirmar_venta.sql`
- Create: `sql/tests/confirmar_venta_v2.sql`

**Interfaces:**
- Consumes: columnas de la Tarea 2.
- Produces: `confirmar_venta(p_feria_id uuid, p_items jsonb, p_metodo_pago text default 'efectivo', p_descuento numeric default 0, p_client_venta_id uuid default null) returns table(venta_id uuid, total numeric)`. Invocable desde el cliente como `supabase.rpc('confirmar_venta', { p_feria_id, p_items, p_metodo_pago, p_descuento, p_client_venta_id })`. `p_items` acepta ahora tres tipos de línea:
  - producto: `{"tipo":"producto","producto_id":"<uuid>","cantidad":2}`
  - combo: `{"tipo":"combo","combo_id":"<uuid>","producto_ids":["<uuid>","<uuid>"]}`
  - manual: `{"tipo":"manual","nombre":"Pedido especial","precio":500}`
  Idempotente por `p_client_venta_id`: una segunda llamada con el mismo id devuelve la venta existente sin re-cobrar. `total` devuelto = bruto − descuento.

- [ ] **Step 1: Reemplazar el contenido de `sql/rpc_confirmar_venta.sql`**

```sql
-- v2: se dropea la firma vieja (2 args) para que quede una sola función con defaults.
drop function if exists confirmar_venta(uuid, jsonb);

create or replace function confirmar_venta(
  p_feria_id uuid,
  p_items jsonb,
  p_metodo_pago text default 'efectivo',
  p_descuento numeric default 0,
  p_client_venta_id uuid default null
)
returns table (venta_id uuid, total numeric)
language plpgsql
as $$
declare
  v_venta_id uuid := gen_random_uuid();
  v_bruto numeric := 0;
  v_total numeric := 0;
  v_item jsonb;
  v_producto record;
  v_categoria_nombre text;
  v_precio numeric;
  v_costo_unit numeric;
  v_venta_item_id uuid;
  v_combo record;
  v_combo_costo numeric;
  v_producto_id_text text;
  v_insumo record;
  v_cantidad integer;
  v_existing_id uuid;
  v_existing_total numeric;
begin
  -- Idempotencia: si ya hay una venta con este client_venta_id, devolverla sin re-cobrar.
  if p_client_venta_id is not null then
    select id, ventas.total into v_existing_id, v_existing_total
      from ventas where client_venta_id = p_client_venta_id;
    if found then
      return query select v_existing_id, v_existing_total;
      return;
    end if;
  end if;

  if p_metodo_pago not in ('efectivo','transferencia','otro') then
    raise exception 'Método de pago inválido: %', p_metodo_pago;
  end if;
  if coalesce(p_descuento, 0) < 0 then
    raise exception 'El descuento no puede ser negativo';
  end if;

  -- Subbloque a prueba de reintentos concurrentes: si dos llamadas con el mismo
  -- client_venta_id se solapan, la 2da choca el índice único al insertar la venta
  -- (antes de tocar stock) y el handler devuelve la venta que ganó, sin error crudo.
  begin
  insert into ventas (id, feria_id, total, metodo_pago, descuento, client_venta_id)
    values (v_venta_id, p_feria_id, 0, p_metodo_pago, coalesce(p_descuento, 0), p_client_venta_id);

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    if v_item->>'tipo' = 'producto' then
      v_cantidad := (v_item->>'cantidad')::integer;

      select p.id, p.nombre, p.costo, fp.categoria_precio_id, fp.precio_override
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

      -- costo unitario snapshot = costo del producto + costo de sus insumos por receta
      v_costo_unit := coalesce(v_producto.costo, 0);
      for v_insumo in
        select pi.insumo_id, pi.cantidad, i.nombre as insumo_nombre, i.costo as insumo_costo
        from producto_insumos pi join insumos i on i.id = pi.insumo_id
        where pi.producto_id = v_producto.id
      loop
        update insumos set stock = stock - (v_insumo.cantidad * v_cantidad)
          where id = v_insumo.insumo_id and stock >= (v_insumo.cantidad * v_cantidad);
        if not found then
          raise exception 'No queda suficiente insumo "%" para "%"', v_insumo.insumo_nombre, v_producto.nombre;
        end if;
        v_costo_unit := v_costo_unit + coalesce(v_insumo.insumo_costo, 0) * v_insumo.cantidad;
      end loop;

      insert into venta_items (venta_id, tipo, producto_id, producto_nombre, categoria_precio_nombre, cantidad, precio_unitario, costo_unitario)
        values (v_venta_id, 'producto', v_producto.id, v_producto.nombre, v_categoria_nombre, v_cantidad, v_precio, v_costo_unit);

      v_bruto := v_bruto + v_precio * v_cantidad;

    elsif v_item->>'tipo' = 'combo' then
      select * into v_combo from combos where id = (v_item->>'combo_id')::uuid and activo for update;
      if not found then
        raise exception 'Combo % no está disponible', v_item->>'combo_id';
      end if;

      insert into venta_items (venta_id, tipo, combo_id, producto_nombre, cantidad, precio_unitario)
        values (v_venta_id, 'combo', v_combo.id, v_combo.nombre, 1, v_combo.precio)
        returning id into v_venta_item_id;

      v_bruto := v_bruto + v_combo.precio;
      v_combo_costo := 0;

      for v_producto_id_text in select jsonb_array_elements_text(v_item->'producto_ids')
      loop
        select id, nombre, costo into v_producto from productos where id = v_producto_id_text::uuid for update;
        if not found then
          raise exception 'Producto % del combo no existe', v_producto_id_text;
        end if;

        update productos set stock = stock - 1 where id = v_producto.id and stock >= 1;
        if not found then
          raise exception 'No queda suficiente stock de "%" para el combo', v_producto.nombre;
        end if;

        insert into venta_item_combo_productos (venta_item_id, producto_id, producto_nombre)
          values (v_venta_item_id, v_producto.id, v_producto.nombre);

        v_combo_costo := v_combo_costo + coalesce(v_producto.costo, 0);
        for v_insumo in
          select pi.insumo_id, pi.cantidad, i.nombre as insumo_nombre, i.costo as insumo_costo
          from producto_insumos pi join insumos i on i.id = pi.insumo_id
          where pi.producto_id = v_producto.id
        loop
          update insumos set stock = stock - v_insumo.cantidad
            where id = v_insumo.insumo_id and stock >= v_insumo.cantidad;
          if not found then
            raise exception 'No queda suficiente insumo "%" para "%"', v_insumo.insumo_nombre, v_producto.nombre;
          end if;
          v_combo_costo := v_combo_costo + coalesce(v_insumo.insumo_costo, 0) * v_insumo.cantidad;
        end loop;
      end loop;

      update venta_items set costo_unitario = v_combo_costo where id = v_venta_item_id;

    elsif v_item->>'tipo' = 'manual' then
      if (v_item->>'precio') is null or (v_item->>'precio')::numeric <= 0 then
        raise exception 'La línea manual requiere un precio mayor a 0';
      end if;
      insert into venta_items (venta_id, tipo, producto_nombre, cantidad, precio_unitario)
        values (v_venta_id, 'manual', coalesce(nullif(trim(v_item->>'nombre'), ''), 'Venta manual'), 1, (v_item->>'precio')::numeric);
      v_bruto := v_bruto + (v_item->>'precio')::numeric;
    end if;
  end loop;

  if coalesce(p_descuento, 0) > v_bruto then
    raise exception 'El descuento ($%) no puede superar el total ($%)', p_descuento, v_bruto;
  end if;

  v_total := v_bruto - coalesce(p_descuento, 0);
  update ventas set total = v_total where id = v_venta_id;
  exception when unique_violation then
    -- Otra transacción ya creó la venta con este client_venta_id: devolverla en
    -- vez de un error crudo (garantía "tocá de nuevo, no se cobra dos veces").
    select id, ventas.total into v_existing_id, v_existing_total
      from ventas where client_venta_id = p_client_venta_id;
    return query select v_existing_id, v_existing_total;
    return;
  end;

  return query select v_venta_id, v_total;
end;
$$;

grant execute on function confirmar_venta(uuid, jsonb, text, numeric, uuid) to authenticated;
```

Correr el archivo completo en el SQL Editor.

- [ ] **Step 2: Escribir `sql/tests/confirmar_venta_v2.sql`**

```sql
-- Tests de confirmar_venta v2. PASA si el editor muestra 'ROLLBACK_OK'.
do $$
declare
  v_feria uuid;
  v_cat uuid;
  v_prod uuid;
  v_insumo uuid;
  v_res record;
  v_res2 record;
  v_client uuid := gen_random_uuid();
  v_metodo text;
  v_descuento numeric;
  v_costo numeric;
  v_nventas integer;
  v_manual_precio numeric;
begin
  -- setup: producto con costo 30, insumo con costo 5 y receta 2 => costo_unit = 30 + 5*2 = 40
  insert into ferias (nombre, emoji, slug) values ('TEST v2', '🧪', 'test-v2-feria') returning id into v_feria;
  insert into categorias_precio (feria_id, nombre, precio) values (v_feria, 'TestCat', 100) returning id into v_cat;
  insert into productos (nombre, stock, costo) values ('TEST prod', 10, 30) returning id into v_prod;
  insert into feria_productos (feria_id, producto_id, categoria_precio_id) values (v_feria, v_prod, v_cat);
  insert into insumos (nombre, stock, costo) values ('TEST insumo', 20, 5) returning id into v_insumo;
  insert into producto_insumos (producto_id, insumo_id, cantidad) values (v_prod, v_insumo, 2);

  -- A) venta con pago 'transferencia', descuento 50, idempotencia
  select * into v_res from confirmar_venta(
    v_feria,
    format('[{"tipo":"producto","producto_id":"%s","cantidad":2}]', v_prod)::jsonb,
    'transferencia', 50, v_client
  );
  -- total = 2*100 - 50 = 150
  assert v_res.total = 150, format('A) total esperado 150, obtenido %s', v_res.total);
  select metodo_pago, descuento into v_metodo, v_descuento from ventas where id = v_res.venta_id;
  assert v_metodo = 'transferencia', format('A) metodo esperado transferencia, obtenido %s', v_metodo);
  assert v_descuento = 50, format('A) descuento esperado 50, obtenido %s', v_descuento);
  -- costo snapshot en la línea = 40
  select costo_unitario into v_costo from venta_items where venta_id = v_res.venta_id and tipo = 'producto';
  assert v_costo = 40, format('A) costo_unitario esperado 40, obtenido %s', v_costo);

  -- B) idempotencia: mismo client_venta_id devuelve la MISMA venta, no crea otra
  select * into v_res2 from confirmar_venta(
    v_feria,
    format('[{"tipo":"producto","producto_id":"%s","cantidad":2}]', v_prod)::jsonb,
    'transferencia', 50, v_client
  );
  assert v_res2.venta_id = v_res.venta_id, 'B) idempotencia: debería devolver la misma venta_id';
  select count(*) into v_nventas from ventas where client_venta_id = v_client;
  assert v_nventas = 1, format('B) esperado 1 venta con ese client_id, obtenido %s', v_nventas);
  -- stock bajó solo una vez: 10 - 2 = 8
  assert (select stock from productos where id = v_prod) = 8, 'B) el stock debe haber bajado una sola vez';

  -- C) línea manual de monto libre
  select * into v_res from confirmar_venta(
    v_feria,
    '[{"tipo":"manual","nombre":"Pedido especial","precio":500}]'::jsonb,
    'efectivo', 0, gen_random_uuid()
  );
  assert v_res.total = 500, format('C) total manual esperado 500, obtenido %s', v_res.total);
  select precio_unitario into v_manual_precio from venta_items where venta_id = v_res.venta_id and tipo = 'manual';
  assert v_manual_precio = 500, format('C) precio manual esperado 500, obtenido %s', v_manual_precio);

  -- D) descuento no puede superar el bruto
  begin
    perform confirmar_venta(
      v_feria,
      format('[{"tipo":"producto","producto_id":"%s","cantidad":1}]', v_prod)::jsonb,
      'efectivo', 9999, gen_random_uuid()
    );
    assert false, 'D) debería haber fallado: descuento > total';
  exception when others then
    assert sqlerrm like '%no puede superar%', format('D) mensaje inesperado: %s', sqlerrm);
  end;

  -- E) línea manual sin precio válido: falla clara, no NULL ni monto negativo
  begin
    perform confirmar_venta(
      v_feria,
      '[{"tipo":"manual","nombre":"Sin precio"}]'::jsonb,
      'efectivo', 0, gen_random_uuid()
    );
    assert false, 'E) debería haber fallado: línea manual sin precio';
  exception when others then
    assert sqlerrm like '%precio mayor a 0%', format('E) mensaje inesperado: %s', sqlerrm);
  end;

  raise exception 'ROLLBACK_OK';
end $$;
```

- [ ] **Step 3: Correr los tests**

Pegar `sql/tests/confirmar_venta_v2.sql` en el SQL Editor → Run. Expected: error `ROLLBACK_OK`. Volver a correr `sql/tests/confirmar_venta_baseline.sql` → debe seguir en `ROLLBACK_OK` (la venta simple de 2 args sigue funcionando vía defaults).

- [ ] **Step 4: Commit**

```bash
git add sql/rpc_confirmar_venta.sql sql/tests/confirmar_venta_v2.sql
git commit -m "Rewrite confirmar_venta: payment, discount, idempotency, cost snapshot, manual lines"
```

---

### Task 4: RPC `anular_venta` (reposición de stock + soft-delete)

**Files:**
- Create: `sql/rpc_anular_venta.sql`
- Create: `sql/tests/anular_venta.sql`

**Interfaces:**
- Consumes: columnas de anulación de la Tarea 2; `confirmar_venta` (Tarea 3) para armar el escenario de test.
- Produces: `anular_venta(p_venta_id uuid, p_motivo text default null) returns void`. Repone en una transacción el stock de productos e insumos que la venta descontó (líneas `producto` y `combo`; las `manual` no mueven stock), y marca `anulada=true, anulada_at=now(), anulada_by=auth.uid(), motivo_anulacion=p_motivo`. Nunca borra filas. Falla si la venta no existe o ya estaba anulada. Invocable como `supabase.rpc('anular_venta', { p_venta_id, p_motivo })`.

- [ ] **Step 1: Escribir `sql/rpc_anular_venta.sql`**

```sql
create or replace function anular_venta(p_venta_id uuid, p_motivo text default null)
returns void
language plpgsql
as $$
declare
  v_venta record;
  v_item record;
  v_combo_prod record;
  v_insumo record;
begin
  select * into v_venta from ventas where id = p_venta_id for update;
  if not found then
    raise exception 'La venta % no existe', p_venta_id;
  end if;
  if v_venta.anulada then
    raise exception 'Esta venta ya estaba anulada';
  end if;

  for v_item in select * from venta_items where venta_id = p_venta_id
  loop
    if v_item.tipo = 'producto' and v_item.producto_id is not null then
      update productos set stock = stock + v_item.cantidad where id = v_item.producto_id;
      for v_insumo in
        select insumo_id, cantidad from producto_insumos where producto_id = v_item.producto_id
      loop
        update insumos set stock = stock + (v_insumo.cantidad * v_item.cantidad) where id = v_insumo.insumo_id;
      end loop;

    elsif v_item.tipo = 'combo' then
      for v_combo_prod in select * from venta_item_combo_productos where venta_item_id = v_item.id
      loop
        if v_combo_prod.producto_id is not null then
          update productos set stock = stock + 1 where id = v_combo_prod.producto_id;
          for v_insumo in
            select insumo_id, cantidad from producto_insumos where producto_id = v_combo_prod.producto_id
          loop
            update insumos set stock = stock + v_insumo.cantidad where id = v_insumo.insumo_id;
          end loop;
        end if;
      end loop;
    end if;
    -- tipo 'manual': no movió stock, no se repone nada
  end loop;

  update ventas
    set anulada = true, anulada_at = now(), anulada_by = auth.uid(), motivo_anulacion = p_motivo
    where id = p_venta_id;
end;
$$;

grant execute on function anular_venta(uuid, text) to authenticated;
```

Nota (caveat documentado): la reposición de insumos usa la **receta actual** del producto. Si la receta cambió entre la venta y la anulación, la reposición de insumos puede diferir levemente; el stock del producto sí se repone exacto (por `cantidad` snapshot en `venta_items`). Aceptable para v2.

Correr el archivo en el SQL Editor.

- [ ] **Step 2: Escribir `sql/tests/anular_venta.sql`**

```sql
-- Test de anular_venta. PASA si el editor muestra 'ROLLBACK_OK'.
do $$
declare
  v_feria uuid;
  v_cat uuid;
  v_prod uuid;
  v_insumo uuid;
  v_res record;
begin
  insert into ferias (nombre, emoji, slug) values ('TEST anular', '🧪', 'test-anular-feria') returning id into v_feria;
  insert into categorias_precio (feria_id, nombre, precio) values (v_feria, 'TestCat', 100) returning id into v_cat;
  insert into productos (nombre, stock, costo) values ('TEST prod', 10, 0) returning id into v_prod;
  insert into feria_productos (feria_id, producto_id, categoria_precio_id) values (v_feria, v_prod, v_cat);
  insert into insumos (nombre, stock, costo) values ('TEST insumo', 20, 0) returning id into v_insumo;
  insert into producto_insumos (producto_id, insumo_id, cantidad) values (v_prod, v_insumo, 2);

  -- vender 3: stock 10->7, insumo 20->14
  select * into v_res from confirmar_venta(
    v_feria,
    format('[{"tipo":"producto","producto_id":"%s","cantidad":3}]', v_prod)::jsonb
  );
  assert (select stock from productos where id = v_prod) = 7, 'pre: stock debía ser 7';
  assert (select stock from insumos where id = v_insumo) = 14, 'pre: insumo debía ser 14';

  -- anular: stock 7->10, insumo 14->20, flags seteados
  perform anular_venta(v_res.venta_id, 'me equivoqué de producto');
  assert (select stock from productos where id = v_prod) = 10, 'post: stock debía volver a 10';
  assert (select stock from insumos where id = v_insumo) = 20, 'post: insumo debía volver a 20';
  assert (select anulada from ventas where id = v_res.venta_id) = true, 'post: anulada debía ser true';
  assert (select motivo_anulacion from ventas where id = v_res.venta_id) = 'me equivoqué de producto', 'post: motivo no coincide';
  assert (select anulada_at is not null from ventas where id = v_res.venta_id), 'post: anulada_at debía setearse';

  -- doble anulación falla
  begin
    perform anular_venta(v_res.venta_id, 'otra vez');
    assert false, 'doble anulación debería fallar';
  exception when others then
    assert sqlerrm like '%ya estaba anulada%', format('mensaje inesperado: %s', sqlerrm);
  end;

  raise exception 'ROLLBACK_OK';
end $$;
```

- [ ] **Step 3: Correr el test**

Pegar `sql/tests/anular_venta.sql` en el SQL Editor → Run. Expected: error `ROLLBACK_OK`.

- [ ] **Step 4: Commit**

```bash
git add sql/rpc_anular_venta.sql sql/tests/anular_venta.sql
git commit -m "Add anular_venta RPC: restock products/insumos + audited soft-delete"
```

---

### Task 5: Costo editable en Inventario (productos e insumos)

**Files:**
- Modify: `js/inventario.js`
- Modify: `js/insumos.js`

**Interfaces:**
- Consumes: `productos.costo`, `insumos.costo` (Tarea 2).
- Produces: la UI que carga el dato de costo que la Tarea 3 snapshotea al vender. Sin esto, todos los costos snapshoteados serían 0.

- [ ] **Step 1: Agregar input de costo a la fila de producto en `js/inventario.js`**

En `renderProductos()`, dentro del template de cada fila (después del `<input ... class="inv-stock-input" ...>`), agregar el input de costo. Reemplazar el bloque del `<span>` + stock input por:

```js
        <span>${p.nombre} — ${precioTexto} — Stock: ${p.stock}</span>
        <label class="inv-mini-label">Stock <input type="number" class="inv-stock-input" data-producto-id="${p.id}" value="${p.stock}" min="0" /></label>
        <label class="inv-mini-label">Costo $<input type="number" class="inv-costo-input" data-producto-id="${p.id}" value="${p.costo ?? 0}" min="0" step="1" /></label>
```

Y en la query de productos de `render()` (la que hace `.select('id, categoria_precio_id, precio_override, productos(id, nombre, imagen_url, stock)')`), agregar `costo`:

```js
  const { data: productos } = await supabase
    .from('feria_productos')
    .select('id, categoria_precio_id, precio_override, productos(id, nombre, imagen_url, stock, costo)')
    .eq('feria_id', feria.id);
```

- [ ] **Step 2: Agregar el listener de costo en `renderProductos()`**

Junto al listener de `.inv-stock-input` en `renderProductos()`, agregar:

```js
  list.querySelectorAll('.inv-costo-input').forEach((input) => {
    input.addEventListener('change', async () => {
      await supabase.from('productos').update({ costo: Number(input.value) }).eq('id', input.dataset.productoId);
      render(feria, container);
    });
  });
```

- [ ] **Step 3: Agregar input de costo a insumos en `js/insumos.js`**

En `renderInsumosSection()`, en el template de cada insumo, agregar el input de costo. Reemplazar el bloque de la fila por:

```js
    <div class="inv-row" data-id="${i.id}">
      <span>${i.nombre}</span>
      <label class="inv-mini-label">Stock <input type="number" class="insumo-stock-input" data-id="${i.id}" value="${i.stock}" min="0" /></label>
      <label class="inv-mini-label">Costo $<input type="number" class="insumo-costo-input" data-id="${i.id}" value="${i.costo ?? 0}" min="0" step="1" /></label>
      <button class="btn-icon" data-action="eliminar-insumo" data-id="${i.id}">🗑️</button>
    </div>
```

Y en el `<form id="form-insumo">`, agregar un input de costo antes del botón:

```js
    <form id="form-insumo" class="inv-form">
      <input name="nombre" placeholder="Nombre (ej: Bolsita transparente)" required />
      <input name="stock" type="number" min="0" placeholder="Stock inicial" required />
      <input name="costo" type="number" min="0" step="1" placeholder="Costo $" value="0" />
      <button type="submit">Agregar insumo</button>
    </form>
```

- [ ] **Step 4: Cablear los listeners de costo de insumo en `js/insumos.js`**

Junto al listener de `.insumo-stock-input`, agregar:

```js
  list.querySelectorAll('.insumo-costo-input').forEach((input) => {
    input.addEventListener('change', async () => {
      await supabase.from('insumos').update({ costo: Number(input.value) }).eq('id', input.dataset.id);
    });
  });
```

Y en el submit de `#form-insumo`, incluir el costo:

```js
  container.querySelector('#form-insumo').addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.target;
    await supabase.from('insumos').insert({ nombre: form.nombre.value.trim(), stock: Number(form.stock.value), costo: Number(form.costo.value || 0) });
    renderInsumosSection(container);
  });
```

- [ ] **Step 5: Agregar estilo `.inv-mini-label` a `styles.css`**

```css
.inv-mini-label { display: inline-flex; align-items: center; gap: 4px; font-size: 0.75rem; opacity: 0.8; }
.inv-mini-label input { width: 64px; }
```

- [ ] **Step 6: Verificación manual**

Servidor local corriendo. Entrar a una feria → Inventario. En un producto, escribir Costo `30` y salir del campo → recargar la página → el costo debe seguir en `30`. En Insumos, poner Costo `5` en un insumo → recargar → persiste. Agregar un insumo nuevo con costo `8` → aparece con costo `8`. Confirmar en el SQL Editor: `select nombre, costo from productos where costo > 0 limit 5;` devuelve el/los editados.

- [ ] **Step 7: Commit**

```bash
git add js/inventario.js js/insumos.js styles.css
git commit -m "Add editable cost to products and insumos in Inventario"
```

---

### Task 6: Vender — método de pago + idempotencia + timeout (arreglar el botón colgado)

**Files:**
- Modify: `js/vender.js`
- Modify: `styles.css`

**Interfaces:**
- Consumes: `confirmar_venta` v2 (Tarea 3).
- Produces: el flujo de confirmación pasa `p_metodo_pago`, `p_client_venta_id` (idempotente) y aborta con timeout. Deja `metodoPagoActual` y `clientVentaIdPendiente` como estado del módulo, listos para que la Tarea 7 agregue el descuento.

- [ ] **Step 1: Agregar estado de módulo en `js/vender.js`**

Debajo de `let carrito = [];` (línea 5), agregar:

```js
let metodoPagoActual = 'efectivo';
let clientVentaIdPendiente = null;
```

Y en `initVender()`, al resetear el carrito (`carrito = [];`), resetear también:

```js
  carrito = [];
  metodoPagoActual = 'efectivo';
  clientVentaIdPendiente = null;
```

- [ ] **Step 2: Agregar el selector de método de pago al panel del carrito**

En `renderCarrito()`, dentro del `panel.innerHTML`, entre `<p class="carrito-total">…</p>` y `<div class="carrito-actions">`, insertar:

```js
    <div class="carrito-pago">
      <span>Pago:</span>
      ${['efectivo', 'transferencia', 'otro'].map((m) => `
        <button type="button" class="pago-btn ${metodoPagoActual === m ? 'active' : ''}" data-metodo="${m}">
          ${m === 'efectivo' ? '💵 Efectivo' : m === 'transferencia' ? '📲 Transfer' : '🔵 Otro'}
        </button>
      `).join('')}
    </div>
```

Y en el mismo `renderCarrito()`, después de los listeners existentes, agregar:

```js
  panel.querySelectorAll('.pago-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      metodoPagoActual = btn.dataset.metodo;
      panel.querySelectorAll('.pago-btn').forEach((b) => b.classList.toggle('active', b.dataset.metodo === metodoPagoActual));
    });
  });
```

- [ ] **Step 3: Reemplazar el handler de confirmar venta con idempotencia + timeout**

Reemplazar el listener completo de `#btn-confirmar-venta` en `renderCarrito()` por:

```js
  panel.querySelector('#btn-confirmar-venta').addEventListener('click', async () => {
    if (!navigator.onLine) {
      toast('Sin conexión — no se puede confirmar la venta ahora');
      return;
    }

    const btn = panel.querySelector('#btn-confirmar-venta');
    btn.disabled = true;
    btn.textContent = 'Confirmando...';

    // idempotencia: un id estable por carrito; si reintentás, no se cobra dos veces
    if (!clientVentaIdPendiente) clientVentaIdPendiente = crypto.randomUUID();

    const items = carrito.map((l) => l.tipo === 'producto'
      ? { tipo: 'producto', producto_id: l.productoId, cantidad: l.cantidad }
      : { tipo: 'combo', combo_id: l.comboId, producto_ids: l.productos.map((p) => p.id) }
    );

    const controller = new AbortController();
    let timedOut = false;
    const timeout = setTimeout(() => { timedOut = true; controller.abort(); }, 15000);

    let data, error;
    try {
      ({ data, error } = await supabase
        .rpc('confirmar_venta', {
          p_feria_id: feria.id,
          p_items: items,
          p_metodo_pago: metodoPagoActual,
          p_client_venta_id: clientVentaIdPendiente,
        })
        .abortSignal(controller.signal));
    } catch (e) {
      // postgrest-js normalmente RESUELVE con { error } ante un abort (no rechaza);
      // este catch es un respaldo por si alguna versión/entorno sí rechaza.
      error = e;
    } finally {
      clearTimeout(timeout);
    }

    btn.disabled = false;
    btn.textContent = 'Confirmar venta';

    // `timedOut` es la señal determinística de nuestro propio timeout (no depende de
    // matchear el texto del error); el regex cubre además un abort de otra fuente.
    if (timedOut || (error && /abort/i.test(error.message || ''))) {
      toast('La red está lenta. Tocá de nuevo para reintentar — no se cobra dos veces.');
      return;
    }
    if (error) {
      toast(`No se pudo confirmar la venta: ${error.message}`);
      return;
    }

    carrito = [];
    clientVentaIdPendiente = null;
    metodoPagoActual = 'efectivo';
    if (window.confetti) window.confetti({ particleCount: 120, spread: 80, origin: { y: 0.7 } });
    toast(`¡Venta registrada! 🎉 Total: $${data[0].total}`);
    loadAndRender(feria, container);
  });
```

- [ ] **Step 4: Invalidar el id de idempotencia cuando cambia el carrito**

Al principio de `refrescarCarrito()` (antes de reconstruir el panel), agregar:

```js
function refrescarCarrito(feria, container) {
  clientVentaIdPendiente = null; // el carrito cambió => nueva venta lógica
  const viejo = container.querySelector('#carrito-panel');
```

- [ ] **Step 5: Estilos del selector de pago en `styles.css`**

```css
.carrito-pago { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; margin: 8px 0; font-size: 0.9rem; }
.pago-btn { background: white; color: var(--text); box-shadow: none; border: 2px solid #DDE3F5; padding: 6px 10px; font-size: 0.85rem; }
.pago-btn.active { background: var(--accent); color: white; border-color: var(--accent); }
```

- [ ] **Step 6: Verificación manual**

Servidor local. Feria con un producto con precio y stock. Armar un carrito, elegir "📲 Transfer" (se resalta). Confirmar → confetti + toast. En el SQL Editor: `select metodo_pago, total from ventas order by created_at desc limit 1;` → `transferencia` y el total correcto.

**Idempotencia (determinístico, SQL Editor):** correr dos veces seguidas la misma llamada con un `client_venta_id` fijo:
```sql
select * from confirmar_venta(
  (select id from ferias where slug = 'stickers'),
  format('[{"tipo":"producto","producto_id":"%s","cantidad":1}]',
         (select producto_id from feria_productos
            where feria_id = (select id from ferias where slug='stickers') limit 1))::jsonb,
  'efectivo', 0, '11111111-1111-1111-1111-111111111111'
);
```
La 1ra corrida crea la venta; la 2da debe devolver el **mismo** `venta_id` **sin** volver a descontar stock. Confirmar `select count(*) from ventas where client_venta_id = '11111111-1111-1111-1111-111111111111';` → `1`. Limpiar después: `delete from ventas where client_venta_id = '11111111-1111-1111-1111-111111111111';` (y reponer a mano el stock del producto de prueba si hace falta).

**Timeout / botón colgado (determinístico, DevTools):** bajar temporalmente el `15000` del `setTimeout` a `100` en `vender.js` (o en DevTools → Network → click derecho sobre una request a `/rest/v1/rpc/confirmar_venta` → "Block request URL"). Confirmar la venta → debe aparecer el toast "La red está lenta. Tocá de nuevo para reintentar — no se cobra dos veces." y el botón debe **volver a habilitarse** (no queda colgado). Restaurar el timeout / quitar el bloqueo después.

- [ ] **Step 7: Commit**

```bash
git add js/vender.js styles.css
git commit -m "Vender: capture payment method, idempotent checkout, RPC timeout"
```

---

### Task 7: Vender — descuento por monto en el carrito

**Files:**
- Modify: `js/vender.js`

**Interfaces:**
- Consumes: `confirmar_venta` v2 param `p_descuento` (Tarea 3); estado del carrito de la Tarea 6.
- Produces: un `descuentoActual` que se resta del total mostrado y viaja al RPC.

- [ ] **Step 1: Agregar estado de descuento**

Debajo de `let clientVentaIdPendiente = null;` (Tarea 6), agregar:

```js
let descuentoActual = 0;
```

En `initVender()` y en `refrescarCarrito()` (donde ya se resetea/invalida), resetear `descuentoActual = 0;` en `initVender()` únicamente (no en refrescar, para no borrar el descuento al agregar ítems). En `initVender()`:

```js
  carrito = [];
  metodoPagoActual = 'efectivo';
  clientVentaIdPendiente = null;
  descuentoActual = 0;
```

- [ ] **Step 2: Mostrar el input de descuento y el total neto**

En `renderCarrito()`, calcular el bruto y el neto. Reemplazar la línea que calcula `const total = …` y el `<p class="carrito-total">` por:

```js
  const bruto = carrito.reduce((sum, l) => sum + l.precio * (l.tipo === 'producto' ? l.cantidad : 1), 0);
  descuentoActual = Math.min(descuentoActual, bruto); // re-clamp: si el carrito se achicó, el descuento no puede superar el nuevo bruto
  const total = Math.max(0, bruto - descuentoActual);
```

y en el `innerHTML`, reemplazar `<p class="carrito-total">Total: $${total}</p>` por:

```js
    <div class="carrito-descuento">
      <label>Descuento $ <input type="number" id="input-descuento" min="0" step="1" value="${descuentoActual || ''}" placeholder="0" /></label>
    </div>
    <p class="carrito-total">Total: $${total}${descuentoActual ? ` <s>$${bruto}</s>` : ''}</p>
```

- [ ] **Step 3: Cablear el input de descuento**

En `renderCarrito()`, junto a los otros listeners, agregar:

```js
  const inputDescuento = panel.querySelector('#input-descuento');
  if (inputDescuento) {
    inputDescuento.addEventListener('change', () => {
      const val = Math.max(0, Number(inputDescuento.value) || 0);
      descuentoActual = Math.min(val, bruto);
      const viejo = container.querySelector('#carrito-panel');
      const nuevo = renderCarrito(feria, container);
      if (viejo) viejo.replaceWith(nuevo);
    });
  }
```

- [ ] **Step 4: Pasar el descuento al RPC**

En el handler de `#btn-confirmar-venta` (Tarea 6), agregar `p_descuento` a la llamada:

```js
        .rpc('confirmar_venta', {
          p_feria_id: feria.id,
          p_items: items,
          p_metodo_pago: metodoPagoActual,
          p_descuento: descuentoActual,
          p_client_venta_id: clientVentaIdPendiente,
        })
```

Y al limpiar tras éxito, resetear `descuentoActual = 0;` junto a los otros resets.

- [ ] **Step 5: Estilos del descuento**

```css
.carrito-descuento { margin: 4px 0; font-size: 0.9rem; }
.carrito-descuento input { width: 90px; padding: 4px 8px; border-radius: 8px; border: 1px solid #DDE3F5; font-family: inherit; }
.carrito-total s { opacity: 0.5; font-weight: 500; font-size: 0.9rem; }
```

- [ ] **Step 6: Verificación manual**

Armar un carrito que sume $1000. Escribir Descuento `200` → el total muestra `$800` con `$1000` tachado. Confirmar → toast "Total: $800". En SQL Editor: `select total, descuento from ventas order by created_at desc limit 1;` → `total=800, descuento=200`. Probar que un descuento mayor al bruto se clampea al bruto (escribir `99999` → total `$0`, no negativo).

- [ ] **Step 7: Commit**

```bash
git add js/vender.js styles.css
git commit -m "Vender: per-sale discount amount applied through the RPC"
```

---

### Task 8: Vender — buscador, orden estable, favoritos congelados y precio al vuelo

**Files:**
- Modify: `js/vender.js`
- Modify: `styles.css`

**Interfaces:**
- Consumes: `feria_productos` (con `productos`), `ventas`/`venta_items` (para el ranking de favoritos), `feria_productos.precio_override` (fijar precio al vuelo).
- Produces: un grid buscable, ordenado alfabéticamente estable, con los más vendidos (ranking congelado al abrir la feria) arriba, y tarjetas sin categoría que permiten fijar precio sin salir de Vender.

- [ ] **Step 1: Cargar el ranking congelado una vez en `initVender()`**

Agregar estado de módulo debajo de `let descuentoActual = 0;`:

```js
let filtroBusqueda = '';
let rankingCongelado = []; // ids de producto ordenados por más vendidos, calculado 1 vez por sesión de feria
```

En `initVender()`, resetear `filtroBusqueda = '';` y cargar el ranking una vez (antes de `loadAndRender`):

```js
  filtroBusqueda = '';
  // initVender NO puede ser async (devuelve la función de cleanup a nav.js), así que
  // no se puede `await`. Se re-renderiza cuando el ranking resuelve, para que el orden
  // "más vendidos arriba" se aplique aunque el usuario no interactúe.
  cargarRanking(feria).then(() => loadAndRender(feria, container));
```

Y agregar la función `cargarRanking()` al final del archivo:

```js
async function cargarRanking(feria) {
  const { data } = await supabase
    .from('venta_items')
    .select('producto_id, cantidad, ventas!inner(feria_id, anulada)')
    .eq('ventas.feria_id', feria.id)
    .eq('ventas.anulada', false)
    .eq('tipo', 'producto')
    .not('producto_id', 'is', null);
  const conteo = {};
  (data || []).forEach((i) => { conteo[i.producto_id] = (conteo[i.producto_id] || 0) + i.cantidad; });
  rankingCongelado = Object.entries(conteo).sort((a, b) => b[1] - a[1]).map(([id]) => id);
}
```

- [ ] **Step 2: Ordenar y filtrar en `render()`**

En `render()`, antes de construir el `grid`, ordenar y filtrar `feriaProductos`:

```js
  const ordenados = [...feriaProductos].sort((a, b) => {
    const ra = rankingCongelado.indexOf(a.productos.id);
    const rb = rankingCongelado.indexOf(b.productos.id);
    const rankA = ra === -1 ? Infinity : ra;
    const rankB = rb === -1 ? Infinity : rb;
    if (rankA !== rankB) return rankA - rankB;               // más vendidos primero (congelado)
    return a.productos.nombre.localeCompare(b.productos.nombre, 'es'); // luego alfabético estable
  });
  const visibles = filtroBusqueda
    ? ordenados.filter((fp) => fp.productos.nombre.toLowerCase().includes(filtroBusqueda.toLowerCase()))
    : ordenados;
```

Y cambiar el `forEach` del grid para iterar `visibles` en vez de `feriaProductos`.

- [ ] **Step 2b: Insertar el buscador arriba del grid**

En `render()`, justo después de `container.innerHTML = '';` y antes de la fila de combos, agregar el buscador:

```js
  const buscador = document.createElement('input');
  buscador.className = 'vender-buscador';
  buscador.type = 'search';
  buscador.placeholder = '🔎 Buscar producto...';
  buscador.value = filtroBusqueda;
  buscador.addEventListener('input', () => {
    filtroBusqueda = buscador.value;
    const scroll = window.scrollY;
    render(feria, feriaProductos, combos, container);
    window.scrollTo(0, scroll);
    container.querySelector('.vender-buscador')?.focus();
  });
  container.appendChild(buscador);
```

- [ ] **Step 2c: Agregar `id` al select de `loadAndRender` (lo necesita el precio al vuelo)**

Sin esto, `fp.id` es `undefined` y el `update … .eq('id', fp.id)` del Step 3 no matchea ninguna fila (falla en silencio). En `js/vender.js`, en `loadAndRender()`, agregar `id` al principio del select de `feria_productos`:

```js
    supabase.from('feria_productos').select('id, categoria_precio_id, precio_override, productos(id, nombre, imagen_url, stock), categorias_precio(precio)').eq('feria_id', feria.id),
```

- [ ] **Step 3: Precio al vuelo en tarjetas sin categoría**

En el `forEach` que arma cada `card`, reemplazar la lógica de tarjeta deshabilitada por precio nulo con un botón "poner precio". Cambiar el bloque que setea `card.disabled` y arma el `innerHTML`:

```js
    const p = fp.productos;
    const precio = precioEfectivo(fp);
    const disponible = p.stock - cantidadEnCarrito(p.id);
    const card = document.createElement('button');
    card.className = 'producto-card';
    if (precio == null) {
      card.classList.add('producto-card--sin-precio');
      card.innerHTML = `
        ${p.imagen_url ? `<img src="${p.imagen_url}" alt="${p.nombre}" />` : '<div class="producto-card__sin-foto">🌸</div>'}
        <span class="producto-card__nombre">${p.nombre}</span>
        <span class="producto-card__poner-precio">Tocar para poner precio</span>
      `;
      card.addEventListener('click', async () => {
        const val = prompt(`Precio de "${p.nombre}" en esta feria:`);
        if (val == null || val.trim() === '' || isNaN(Number(val))) return;
        await supabase.from('feria_productos').update({ precio_override: Number(val) }).eq('id', fp.id);
        loadAndRender(feria, container);
      });
      grid.appendChild(card);
      return; // continúa el forEach
    }
    card.disabled = disponible <= 0;
    card.innerHTML = `
      ${p.imagen_url ? `<img src="${p.imagen_url}" alt="${p.nombre}" />` : '<div class="producto-card__sin-foto">🌸</div>'}
      <span class="producto-card__nombre">${p.nombre}</span>
      <span class="producto-card__precio">$${precio}</span>
      <span class="producto-card__stock">${disponible > 0 ? `Disponible: ${disponible}` : 'Sin stock'}</span>
    `;
    card.addEventListener('click', () => agregarProductoAlCarrito(p, precio, feria, container));
    grid.appendChild(card);
```

(Nota: reemplaza el `feriaProductos.forEach((fp) => { … })` por `visibles.forEach((fp) => { … })` con este cuerpo.)

- [ ] **Step 4: Estilos del buscador y estados de tarjeta**

```css
.vender-buscador { width: 100%; padding: 10px 14px; border-radius: var(--radius); border: 1px solid #DDE3F5; font-family: inherit; font-size: 1rem; margin-bottom: 12px; }
.producto-card--sin-precio { border: 2px dashed var(--accent); opacity: 0.85; }
.producto-card__poner-precio { font-size: 0.75rem; color: var(--accent-strong, var(--accent)); font-weight: 600; text-align: center; }
```

- [ ] **Step 5: Verificación manual**

Feria "Stickers" (53 productos). Al abrir Vender, escribir "lim" en el buscador → el grid filtra a los que contienen "lim" (ej. "Limón"). Borrar el texto → vuelven todos. Confirmar orden estable: recargar la página varias veces → el orden de las tarjetas no cambia entre recargas (alfabético, con los más vendidos arriba si hay ventas). Buscar un producto sin categoría/precio → su tarjeta dice "Tocar para poner precio"; tocarla, poner `250` → la tarjeta pasa a mostrar `$250` y "Disponible: N", y ya se puede agregar al carrito.

- [ ] **Step 6: Commit**

```bash
git add js/vender.js styles.css
git commit -m "Vender: search, stable order, frozen best-sellers, inline price for uncategorized"
```

---

### Task 9: Legibilidad al sol + dejar de refetchear por cada tap

**Files:**
- Modify: `styles.css`
- Modify: `js/vender.js`

**Interfaces:**
- Consumes: nada nuevo (solo estado del render de Vender).
- Produces: tokens de color con contraste AA (`--accent-strong`, `--accent-text`), regla global `button:disabled`, y un render de carrito que recalcula "Disponible" en cliente sin refetch (manteniendo la subscripción Realtime para sync entre dispositivos).

- [ ] **Step 1: Agregar tokens de contraste y regla `:disabled` en `styles.css`**

En `:root`, agregar:

```css
  --accent-strong: #B4531F; /* texto de precio y CTA — verificar >= 4.5:1 sobre blanco con un checker; oscurecer si no llega */
  --accent-text: #FFFFFF;
```

Reemplazar `.producto-card__precio { color: var(--accent); font-weight: 700; }` por:

```css
.producto-card__precio { color: var(--accent-strong); font-weight: 700; }
```

Cambiar el fondo de los botones de acción principales a `--accent-strong` para que el texto blanco pase AA. Reemplazar en `.btn, button { … background: var(--accent); … }` el background por `var(--accent-strong)` **solo** para botones sólidos, y agregar la regla disabled global al final del archivo:

```css
button:disabled, .btn:disabled { opacity: 0.45; cursor: not-allowed; }
```

(Nota: `.btn--secondary`, `.tab-btn`, `.pago-btn` y `.btn-link` ya redefinen su propio `background`/`color`, así que cambiar el default a `--accent-strong` solo afecta a los botones sólidos de acción — Confirmar venta, Agregar, etc.)

- [ ] **Step 2: Guardar los productos cargados en estado de módulo**

En `js/vender.js`, agregar debajo de los otros `let` de módulo:

```js
let feriaProductosActuales = [];
let combosActuales = [];
```

En `loadAndRender()`, después de obtener los datos y antes de `render(...)`, guardarlos:

```js
  feriaProductosActuales = feriaProductos || [];
  combosActuales = combos || [];
  render(feria, feriaProductosActuales, combosActuales, container);
```

- [ ] **Step 3: Recalcular en cliente en `refrescarCarrito()` (sin refetch)**

Reemplazar el cuerpo de `refrescarCarrito()` por una versión que re-renderiza con los datos ya en memoria en vez de llamar a `loadAndRender`:

```js
function refrescarCarrito(feria, container) {
  clientVentaIdPendiente = null; // el carrito cambió => nueva venta lógica
  render(feria, feriaProductosActuales, combosActuales, container); // recalcula "Disponible" en cliente, sin round-trip
}
```

(La subscripción Realtime creada en `initVender()` sigue llamando a `loadAndRender` cuando cambia el stock en OTRO dispositivo, así que la sync entre celulares se mantiene.)

- [ ] **Step 4: Preservar el foco/scroll del buscador tras recalcular**

Como `render()` reconstruye el `container`, y `refrescarCarrito` ahora llama a `render`, verificar que el buscador no pierda el texto: `filtroBusqueda` es estado de módulo (Tarea 8), así que el valor se preserva. No hace falta cambio adicional; solo confirmar en la verificación.

- [ ] **Step 5: Verificación manual**

Servidor local, feria con productos. Abrir DevTools → Network. Tocar un producto para agregarlo al carrito varias veces seguidas → **no** debe aparecer una request a `feria_productos` por cada tap (antes sí). El contador "Disponible" de la tarjeta baja igual en cada tap. Verificar legibilidad: el precio y el botón "Confirmar venta" se leen con claridad (color oscuro/contrastado). Abrir la misma feria en dos pestañas: vender en la pestaña A → el stock en la pestaña B se actualiza solo (Realtime sigue vivo). Un botón deshabilitado (producto sin stock) se ve claramente atenuado.

- [ ] **Step 6: Commit**

```bash
git add styles.css js/vender.js
git commit -m "AA contrast for price/CTA + stop refetching catalog on every cart tap"
```

---

### Task 10: Piso de confiabilidad — health-check real + helper de mutación

**Files:**
- Modify: `js/connection.js`
- Modify: `js/ui.js`
- Modify: `js/inventario.js`
- Modify: `js/insumos.js`

**Interfaces:**
- Consumes: `supabase`.
- Produces: `initConnectionBanner()` que hace ping real a Supabase (no solo `navigator.onLine`, que no detecta wifi-sin-internet); `mutar(promesa, mensajeError)` en `js/ui.js` que captura errores de escritura y muestra toast. Se aplica `mutar` a las escrituras silenciosas de stock/categoría/costo.

- [ ] **Step 1: Reescribir `js/connection.js` con health-check real**

```js
import { supabase } from './supabaseClient.js';

let online = navigator.onLine;
let bannerEl = null;

async function ping() {
  if (!navigator.onLine) { setOnline(false); return; }
  try {
    const { error } = await supabase.from('ferias').select('id', { head: true, count: 'exact' });
    setOnline(!error);
  } catch {
    setOnline(false);
  }
}

function setOnline(value) {
  online = value;
  if (bannerEl) bannerEl.classList.toggle('hidden', online);
}

export function initConnectionBanner() {
  bannerEl = document.getElementById('connection-banner');
  window.addEventListener('online', ping);
  window.addEventListener('offline', () => setOnline(false));
  ping();
  setInterval(ping, 20000); // re-chequeo periódico: detecta wifi conectado pero sin internet
}

export function isOnline() {
  return online;
}
```

- [ ] **Step 2: Usar `isOnline()` en el guard de confirmar venta**

En `js/vender.js`, importar `isOnline` y usarlo en el handler de confirmar (Tarea 6). Cambiar el import de arriba:

```js
import { isOnline } from './connection.js';
```

y la guarda:

```js
    if (!isOnline()) {
      toast('Sin conexión — no se puede confirmar la venta ahora');
      return;
    }
```

- [ ] **Step 3: Agregar `mutar()` a `js/ui.js`**

Al final de `js/ui.js`:

```js
// Ejecuta una escritura de Supabase y avisa por toast si falla, en vez de fallar en silencio.
export async function mutar(promesa, mensajeError = 'No se pudo guardar el cambio') {
  const { data, error } = await promesa;
  if (error) {
    toast(mensajeError);
    console.error(mensajeError, error);
  }
  return { data, error };
}
```

- [ ] **Step 4: Envolver las escrituras silenciosas de stock/categoría/costo**

En `js/inventario.js`, importar `mutar` (agregar a la línea de import de `./ui.js`) y envolver los `await supabase...update(...)` de stock, categoría y costo en `renderProductos()`. Ejemplos exactos:

```js
      await mutar(supabase.from('productos').update({ stock: Number(input.value) }).eq('id', input.dataset.productoId), 'No se pudo actualizar el stock');
```
```js
      await mutar(supabase.from('feria_productos').update({ categoria_precio_id: select.value || null }).eq('id', select.dataset.id), 'No se pudo actualizar la categoría');
```
```js
      await mutar(supabase.from('productos').update({ costo: Number(input.value) }).eq('id', input.dataset.productoId), 'No se pudo actualizar el costo');
```

En `js/insumos.js`, importar `mutar` y envolver los updates de stock y costo de insumo igual (mensajes "No se pudo actualizar el stock del insumo" / "…el costo del insumo").

- [ ] **Step 5: Verificación manual**

Con la app cargada, entrar a Inventario y editar un stock → debe seguir guardando normal (sin toast de error). Simular fallo: en DevTools → Network → Offline, editar un stock → debe aparecer el toast "No se pudo actualizar el stock" (antes fallaba en silencio). Volver a Online. Para el banner: con la app abierta, cortar el wifi de la máquina unos segundos → el banner "Sin conexión" debe aparecer dentro de ~20s aunque `navigator.onLine` mienta; al reconectar, desaparece.

- [ ] **Step 6: Commit**

```bash
git add js/connection.js js/ui.js js/inventario.js js/insumos.js js/vender.js
git commit -m "Reliability floor: real health-check ping + mutation error toasts"
```

---

### Task 11: Reportes — filtrar anuladas + detalle del día por método de pago

**Files:**
- Modify: `js/reportes.js`
- Modify: `js/reporte-general.js`

**Interfaces:**
- Consumes: `ventas.anulada`, `ventas.metodo_pago`, `venta_items` (Tareas 2-3).
- Produces: reportes que excluyen ventas anuladas y un desglose por fecha con las ventas del día (hora, ítems, total, método) + totales por método. La lista de ventas del día la reutiliza la Tarea 13 (anular).

- [ ] **Step 1: Excluir anuladas en `js/reportes.js`**

En `render()`, agregar `.eq('anulada', false)` a la query de `ventas`, y filtrar los items/comboItems por ventas no anuladas. Reemplazar las tres queries por:

```js
  const { data: ventas, error: ventasError } = await supabase
    .from('ventas').select('*').eq('feria_id', feria.id).eq('anulada', false).order('created_at', { ascending: false });

  const { data: items, error: itemsError } = await supabase
    .from('venta_items')
    .select('*, ventas!inner(feria_id, anulada)')
    .eq('ventas.feria_id', feria.id)
    .eq('ventas.anulada', false);

  const { data: comboItems } = await supabase
    .from('venta_item_combo_productos')
    .select('producto_nombre, venta_items!inner(venta_id, ventas!inner(feria_id, anulada))')
    .eq('venta_items.ventas.feria_id', feria.id)
    .eq('venta_items.ventas.anulada', false);
```

- [ ] **Step 2: Llenar el `<details>` por fecha con el detalle del día**

Reemplazar `renderPorFecha(ventas, el)` por una versión que trae los ítems de cada venta y arma el detalle. Necesita los `venta_items` agrupados por venta; reutilizar `items` (ya cargado). Cambiar la llamada en `render()`:

```js
  renderPorFecha(ventas, items, container.querySelector('#reporte-fechas'));
```

y reemplazar la función por:

```js
function renderPorFecha(ventas, items, el) {
  const hoy = new Date().toLocaleDateString('en-CA'); // fecha LOCAL (YYYY-MM-DD), no UTC
  const itemsPorVenta = {};
  items.forEach((i) => {
    (itemsPorVenta[i.venta_id] = itemsPorVenta[i.venta_id] || []).push(i);
  });

  const porFecha = {};
  ventas.forEach((v) => {
    const fecha = new Date(v.created_at).toLocaleDateString('en-CA'); // fecha LOCAL de la venta
    (porFecha[fecha] = porFecha[fecha] || []).push(v);
  });

  const fechas = Object.keys(porFecha).sort().reverse();
  el.innerHTML = fechas.map((fecha) => {
    const ventasDia = porFecha[fecha];
    const totalDia = ventasDia.reduce((s, v) => s + Number(v.total), 0);
    const porMetodo = { efectivo: 0, transferencia: 0, otro: 0 };
    ventasDia.forEach((v) => { porMetodo[v.metodo_pago] = (porMetodo[v.metodo_pago] || 0) + Number(v.total); });
    const esHoy = fecha === hoy;
    const filas = ventasDia.map((v) => {
      const hora = new Date(v.created_at).toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' });
      const desc = (itemsPorVenta[v.id] || []).map((i) => i.tipo === 'producto' ? `${i.producto_nombre} x${i.cantidad}` : i.producto_nombre).join(', ') || '—';
      const metodoIcon = v.metodo_pago === 'efectivo' ? '💵' : v.metodo_pago === 'transferencia' ? '📲' : '🔵';
      return `<div class="venta-fila"><span>${hora} ${metodoIcon}</span><span class="venta-fila__desc">${desc}</span><span>$${v.total}</span></div>`;
    }).join('');
    return `<details class="historial-dia" ${esHoy ? 'open' : ''}>
      <summary>${esHoy ? '⭐ Hoy' : fecha} — $${totalDia} (${ventasDia.length} ventas)</summary>
      <div class="dia-metodos">💵 $${porMetodo.efectivo} · 📲 $${porMetodo.transferencia} · 🔵 $${porMetodo.otro}</div>
      ${filas}
    </details>`;
  }).join('') || '<p class="inv-empty">Todavía no hay ventas</p>';
}
```

- [ ] **Step 3: Excluir anuladas en `js/reporte-general.js`**

En `initReporteGeneral()`, cambiar la query de ventas para excluir anuladas **y** guardar contra fallos de red (MUST #13: no mostrar `$0` falso como si fuera real):

```js
  const { data: ventas, error: ventasError } = await supabase.from('ventas').select('feria_id, total').eq('anulada', false);
  if (ventasError) {
    content.innerHTML = '<p class="error">No se pudo cargar el reporte general — revisá la conexión</p>';
    return;
  }
```

- [ ] **Step 4: Estilos del detalle por fecha**

```css
.dia-metodos { font-size: 0.85rem; opacity: 0.8; padding: 6px 0; border-bottom: 1px solid #f0dccb; }
.venta-fila { display: flex; justify-content: space-between; gap: 8px; padding: 4px 0; font-size: 0.9rem; }
.venta-fila__desc { flex: 1; opacity: 0.8; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
```

- [ ] **Step 5: Verificación manual**

Registrar hoy 2-3 ventas con distintos métodos (una efectivo, una transferencia). Ir a Reportes → "Por fecha". El día de hoy (⭐ Hoy) debe estar abierto y mostrar: la línea de totales por método (💵 $X · 📲 $Y · 🔵 $Z), y cada venta con hora, íconos de método, descripción de ítems y su total. Los totales por método deben sumar el total del día. (La verificación de que las anuladas se excluyen se completa en la Tarea 13.)

- [ ] **Step 6: Commit**

```bash
git add js/reportes.js js/reporte-general.js styles.css
git commit -m "Reports: exclude voided sales + per-day detail with payment-method breakdown"
```

---

### Task 12: Cerrar caja — arqueo del día + celebración de cierre

**Files:**
- Modify: `js/reportes.js`
- Modify: `styles.css`

**Interfaces:**
- Consumes: `ventas` de hoy (no anuladas), sus métodos y totales.
- Produces: una sección "Cerrar caja (hoy)" dentro de la pestaña Reportes con: esperado en efectivo vs contado → diferencia, total transferencia, total otro, # ventas, # anuladas, y un botón "Cerrar caja" que dispara una celebración (confetti + toast "¡Cuadraste!").

- [ ] **Step 1: Agregar la sección de cierre al HTML de `render()` en `js/reportes.js`**

En el `container.innerHTML` de `render()`, agregar como primera `<section>` (arriba de "Por fecha"):

```js
    <section class="inv-section" id="reporte-cierre">
      <h2>🧾 Cerrar caja (hoy)</h2>
      <div id="cierre-content"></div>
    </section>
```

- [ ] **Step 2: Cargar las anuladas de hoy y renderizar el arqueo**

En `render()`, la **query** de anuladas de hoy puede ir después de las queries existentes, pero la **llamada** `renderCierre(...)` debe ir **después** de asignar `container.innerHTML` (cuando `#cierre-content` ya existe en el DOM), junto a `renderPorFecha/renderTopProductos/renderPorCategoria` — si no, `container.querySelector('#cierre-content')` devuelve `null` y revienta.

Después de las queries existentes, agregar el cálculo del inicio del día **LOCAL** y la query de anuladas:

```js
  const inicioHoy = new Date();
  inicioHoy.setHours(0, 0, 0, 0);
  const { count: anuladasHoy } = await supabase
    .from('ventas')
    .select('id', { count: 'exact', head: true })
    .eq('feria_id', feria.id)
    .eq('anulada', true)
    .gte('created_at', inicioHoy.toISOString());
```

Y **después** del `container.innerHTML = …` (junto a los otros `render*(...)`), agregar la llamada:

```js
  renderCierre(ventas, anuladasHoy || 0, container.querySelector('#cierre-content'));
```

y agregar la función:

```js
function renderCierre(ventas, anuladasHoy, el) {
  const hoy = new Date().toLocaleDateString('en-CA'); // fecha LOCAL, no UTC (si no, la caja de una feria nocturna no cuadra)
  const ventasHoy = ventas.filter((v) => new Date(v.created_at).toLocaleDateString('en-CA') === hoy);
  const por = { efectivo: 0, transferencia: 0, otro: 0 };
  ventasHoy.forEach((v) => { por[v.metodo_pago] = (por[v.metodo_pago] || 0) + Number(v.total); });

  el.innerHTML = `
    <div class="cierre-linea"><span>💵 Esperado en efectivo</span><strong>$${por.efectivo}</strong></div>
    <div class="cierre-linea"><span>Contado (lo que hay en la caja)</span><input type="number" id="cierre-contado" min="0" placeholder="$" /></div>
    <div class="cierre-linea" id="cierre-diferencia-row"><span>Diferencia</span><strong id="cierre-diferencia">—</strong></div>
    <hr class="cierre-hr" />
    <div class="cierre-linea"><span>📲 Transferencias</span><strong>$${por.transferencia}</strong></div>
    <div class="cierre-linea"><span>🔵 Otro (QR)</span><strong>$${por.otro}</strong></div>
    <div class="cierre-linea"><span>Ventas del día</span><strong>${ventasHoy.length}</strong></div>
    <div class="cierre-linea"><span>Anuladas hoy</span><strong>${anuladasHoy}</strong></div>
    <button class="btn" id="btn-cerrar-caja">Cerrar caja 🎉</button>
  `;

  const contado = el.querySelector('#cierre-contado');
  const difEl = el.querySelector('#cierre-diferencia');
  contado.addEventListener('input', () => {
    if (contado.value === '') { difEl.textContent = '—'; difEl.className = ''; return; }
    const dif = Number(contado.value) - por.efectivo;
    difEl.textContent = `${dif === 0 ? '✓ ' : ''}$${dif}`;
    difEl.className = dif === 0 ? 'cierre-ok' : 'cierre-diff';
  });

  el.querySelector('#btn-cerrar-caja').addEventListener('click', () => {
    const dif = contado.value === '' ? null : Number(contado.value) - por.efectivo;
    if (window.confetti) window.confetti({ particleCount: 160, spread: 90, origin: { y: 0.6 } });
    if (dif === 0) {
      import('./ui.js').then((m) => m.toast(`¡Cuadraste! 🎉 $${por.efectivo} en efectivo`));
    } else if (dif == null) {
      import('./ui.js').then((m) => m.toast('Caja cerrada 🎉'));
    } else {
      import('./ui.js').then((m) => m.toast(`Cerrada — diferencia de $${dif} en efectivo`));
    }
  });
}
```

- [ ] **Step 3: Estilos del cierre**

```css
#reporte-cierre .cierre-linea { display: flex; justify-content: space-between; align-items: center; padding: 6px 0; }
#reporte-cierre input { width: 120px; padding: 6px 8px; border-radius: 8px; border: 1px solid #DDE3F5; font-family: inherit; text-align: right; }
.cierre-hr { border: none; border-top: 1px solid #f0dccb; margin: 8px 0; }
.cierre-ok { color: #2E7D32; }
.cierre-diff { color: #C0392B; }
#btn-cerrar-caja { width: 100%; margin-top: 12px; }
```

- [ ] **Step 4: Verificación manual**

Con 2 ventas de hoy en efectivo que sumen $800 y una transferencia de $500: ir a Reportes → "Cerrar caja (hoy)". Debe mostrar "Esperado en efectivo $800", "Transferencias $500", "Otro $0", "Ventas del día 3", "Anuladas hoy 0". Escribir Contado `800` → Diferencia "✓ $0" en verde. Escribir `750` → "$-50" en rojo. Tocar "Cerrar caja 🎉" con contado 800 → confetti + toast "¡Cuadraste! 🎉 $800 en efectivo".

- [ ] **Step 5: Commit**

```bash
git add js/reportes.js styles.css
git commit -m "Cerrar caja: end-of-day cash reconciliation with closing celebration"
```

---

### Task 13: Anular venta (UI) + quitar el confirmDialog de cada venta

**Files:**
- Modify: `js/reportes.js`
- Modify: `js/vender.js`
- Modify: `styles.css`

**Interfaces:**
- Consumes: `anular_venta` RPC (Tarea 4); la lista de ventas de hoy del render por fecha (Tarea 11).
- Produces: un botón "Anular" por cada venta de hoy que llama a `anular_venta` (con confirmación y motivo), y la eliminación del `confirmDialog` en cada venta de Vender (ahora que existe la red de seguridad del undo).

- [ ] **Step 1: Agregar botón "Anular" a cada venta de hoy en `renderPorFecha()`**

En `renderPorFecha()` (Tarea 11), solo para el día de hoy, agregar un botón de anular a cada fila. Cambiar la construcción de `filas` para recibir si es hoy y renderizar el botón:

```js
    const filas = ventasDia.map((v) => {
      const hora = new Date(v.created_at).toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' });
      const desc = (itemsPorVenta[v.id] || []).map((i) => i.tipo === 'producto' ? `${i.producto_nombre} x${i.cantidad}` : i.producto_nombre).join(', ') || '—';
      const metodoIcon = v.metodo_pago === 'efectivo' ? '💵' : v.metodo_pago === 'transferencia' ? '📲' : '🔵';
      const anularBtn = esHoy ? `<button class="btn-icon" data-action="anular-venta" data-id="${v.id}" title="Anular venta">↩️</button>` : '';
      return `<div class="venta-fila"><span>${hora} ${metodoIcon}</span><span class="venta-fila__desc">${desc}</span><span>$${v.total}</span>${anularBtn}</div>`;
    }).join('');
```

- [ ] **Step 2: Cablear el botón de anular (delegación en `#reporte-fechas`)**

`renderPorFecha` recibe `el` (el contenedor `#reporte-fechas`). Necesita re-renderizar el reporte tras anular; para eso `render()` debe estar accesible. Pasar `feria` y `container` a `renderPorFecha` y agregar la delegación. Cambiar la firma y la llamada:

En `render()`:
```js
  renderPorFecha(feria, container, ventas, items, container.querySelector('#reporte-fechas'));
```

En la función:
```js
function renderPorFecha(feria, containerRaiz, ventas, items, el) {
```

Y al final de `renderPorFecha`, después de setear `el.innerHTML`, agregar:

```js
  el.querySelectorAll('[data-action="anular-venta"]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const { confirmDialog } = await import('./ui.js');
      const ok = await confirmDialog('¿Anular esta venta? Se repone el stock y los insumos, y queda registrada como anulada.');
      if (!ok) return;
      const motivo = prompt('Motivo (opcional):') || null;
      const { error } = await supabase.rpc('anular_venta', { p_venta_id: btn.dataset.id, p_motivo: motivo });
      const { toast } = await import('./ui.js');
      if (error) { toast(`No se pudo anular: ${error.message}`); return; }
      toast('Venta anulada — stock repuesto');
      render(feria, containerRaiz); // recargar todo el reporte
    });
  });
```

- [ ] **Step 3: Quitar el confirmDialog de cada venta en `js/vender.js`**

En el handler de `#btn-confirmar-venta` (Tarea 6/7), eliminar el bloque de confirmación previa. Quitar estas líneas (ya no existen tras Tarea 6, pero si quedó algún `confirmDialog` de confirmación de venta, eliminarlo). Confirmar que el handler va directo de la guarda `isOnline()` a deshabilitar el botón y llamar al RPC, **sin** `await confirmDialog(...)`. Actualizar el import de `./ui.js` en `vender.js` para quitar `confirmDialog` si ya no se usa en el archivo (sigue usándose sólo si el combo picker lo requiere — verificar; el combo picker usa su propio overlay, no `confirmDialog`, así que se puede dejar solo `toast`):

```js
import { toast } from './ui.js';
```

- [ ] **Step 4: Verificación manual**

En Vender, confirmar una venta → **no** debe aparecer el diálogo "¿Confirmar venta por…?"; va directo al RPC → confetti. Ir a Reportes → "Por fecha" → hoy: cada venta tiene un botón ↩️. Tocar ↩️ en una venta → confirmación → (motivo opcional) → toast "Venta anulada — stock repuesto". La venta desaparece de los totales (el total del día baja) y "Anuladas hoy" en el cierre sube en 1. Verificar en Inventario que el stock del/los producto(s) de esa venta volvió a subir. En SQL Editor: `select anulada, motivo_anulacion, anulada_by from ventas where anulada = true order by anulada_at desc limit 1;` → `anulada=true`, `anulada_by` = el uuid del usuario logueado.

- [ ] **Step 5: Commit**

```bash
git add js/reportes.js js/vender.js styles.css
git commit -m "Void sales from today's report + remove per-sale confirm dialog"
```

---

### Task 14: Pasada de microcopy autoexplicativo (usuaria no técnica)

> **Pasada corrida por el controlador contra la UI ya completa (Tareas 1-13 hechas y verificadas en navegador).** No es una tarea de subagente a ciegas: el copy exacto se escribe mirando cada pantalla renderizada, no adivinando. Requisito de producto: Sofy **solo recibe** la app (no la construyó, no tiene a quién preguntarle en la feria), así que cada control debe explicarse solo. Ver definición v2, ítem 13b.

**Files:**
- Modify: `js/vender.js`, `js/inventario.js`, `js/insumos.js`, `js/reportes.js` (subtítulos / texto de ayuda inline en los render), `index.html` (subtítulos de secciones estáticas), `styles.css` (clase `.help-text`).
- Modify: (según haga falta) cualquier `.js` que renderice un control nuevo de la v2.

**Interfaces:**
- Consumes: la UI final de todas las tareas anteriores (método de pago, descuento, buscador, costo, cerrar caja, anular, receta 🧪).
- Produces: cada control clave con subtítulo / texto de ayuda inline y/o `title=` tooltip que explica en una frase qué hace y por qué, en el mismo tono simple del resto de la app.

- [ ] **Step 1: Estilo base de ayuda** — agregar en `styles.css` una clase reutilizable para el texto de ayuda, con contraste AA sobre `--bg` (no gris apagado ilegible):

```css
.help-text { font-size: 0.8rem; line-height: 1.3; color: #6E4A34; opacity: 0.95; margin-top: 2px; }
```

- [ ] **Step 2: Inventario del microcopy** — recorrer en el navegador cada pantalla y listar cada control que necesita ayuda. Cobertura mínima obligatoria (control → qué debe decir el subtítulo/tooltip):
  - Método de pago (efectivo / transferencia / otro) → "Cómo te pagó el cliente. 'Otro' incluye QR."
  - Descuento → "Rebaja en $ sobre el total de esta venta."
  - Costo de producto / insumo → "Lo que te cuesta a vos. Sirve para calcular la ganancia; no lo ve el cliente."
  - Cerrar caja (esperado vs contado, diferencia) → "'Esperado' es lo que debería haber según las ventas. Escribí lo que contaste; la 'diferencia' te dice si sobra o falta."
  - Anular venta → "Repone el stock y marca la venta como anulada. Queda registrada, no se borra."
  - Buscador (Vender) → "Filtrá productos por nombre para encontrarlos rápido."
  - Receta 🧪 (insumos por producto) → "Insumos que se descuentan al vender este producto."
  - Pantallas existentes que ya confundían: categorías de precio, combos, reutilizar producto, reportes.

- [ ] **Step 3: Escribir el copy en cada render** — para cada control del inventario, agregar el subtítulo/ayuda en el punto de render correspondiente (ej. bajo el selector de pago en `vender.js`, bajo los inputs de costo en `inventario.js`/`insumos.js`, bajo los campos de cierre en `reportes.js`), usando `.help-text` para inline y `title=`/`aria-label` para tooltip. Copy en el tono simple y directo de la app (2ª persona, sin jerga: "venta", "caja", "stock", no "transacción", "RPC", "commit").

- [ ] **Step 4: Verificación en navegador** — abrir cada pantalla en `http://localhost:8000` y en viewport móvil. Criterio de aceptación: una persona que ve la app por primera vez entiende cada control sin preguntarle a nadie. Ningún control nuevo de la v2 queda sin explicación. El texto de ayuda es legible (contraste AA) y no rompe el layout.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "Add self-explanatory microcopy for non-technical user across all controls"
```

---

### Task 15: Pasada de QA visual en navegador (consistencia, contraste, layout)

> **Pasada corrida por el controlador en el navegador (Claude-in-Chrome) contra la UI ya completa.** Requiere ver la app renderizada y juzgar visualmente — no se puede hacer a ciegas desde el diff. La app se la queda Sofy, así que "parece correcto en el código" no alcanza: hay que abrirla y mirarla. Ver definición v2, ítem 13c.

**Files:**
- Modify: `styles.css` (contraste, consistencia de botones, layout/centrado), y los `.js`/`index.html` que rendericen un control mal estilado (ej. convertir el link de "Reporte general" en un `<button>`/`.btn` como el resto).

**Interfaces:**
- Consumes: la UI final de todas las tareas anteriores + el microcopy de la Tarea 14.
- Produces: una UI visualmente consistente (todos los controles del mismo rango se ven iguales), legible (AA) y bien encuadrada, con los defectos ya detectados cerrados.

- [ ] **Step 1: Abrir la app en el navegador** — servir `python -m http.server 8000` desde la raíz, abrir `http://localhost:8000` en Chrome (desktop y viewport móvil ~390px). Recorrer cada pantalla: selección de feria, Vender (carrito), Inventario, Insumos, Reportes (cierre, por fecha, general), login.

- [ ] **Step 2: Cerrar los defectos ya detectados (obligatorio)** — cada uno verificado visualmente antes/después:
  1. **Nombres de las ferias no visibles** en la pantalla de selección → corregir color/contraste para que el nombre de cada feria se lea claramente sobre su tarjeta (AA).
  2. **"Reporte general" es texto-con-link, no botón** → estilizarlo como los demás controles (mismo `.btn`/botón que el resto de la app), no un `<a>` suelto.
  3. **Panel del carrito abajo en Vender no está centrado** → centrar/encuadrar el panel del carrito para que quede alineado con el resto del contenido en desktop y móvil.

- [ ] **Step 3: Barrido de consistencia y contraste** — con los defectos base cerrados, revisar el resto: ¿todos los botones de acción usan el mismo estilo (paleta Toki, `--radius`, no unos con estilo y otros como link)? ¿Algún texto queda con contraste bajo (< AA) sobre `--bg`/`--accent`? ¿Algún elemento se desborda, se solapa o queda descentrado en móvil? Anotar y corregir cada hallazgo ("seguro más cosas de UI").

- [ ] **Step 4: Verificación final** — segunda pasada en navegador (desktop + móvil) confirmando que los 3 defectos base están cerrados y que no quedan inconsistencias visibles. Opcional: capturar un GIF/imagen de las pantallas clave para el registro.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "Visual QA pass: contrast, control consistency, and layout fixes"
```

---

## Self-Review

**Spec coverage (contra la definición v2, sección MUST):**
- Pass único del RPC (pago+costo+descuento+idempotencia+manual) → Tareas 2, 3. ✅
- Costo editable en productos/insumos → Tarea 5. ✅
- Método de pago con un tap → Tarea 6. ✅
- Descuento por monto por venta → Tarea 7. ✅
- Cerrar caja (esperado vs contado + diferencia + transfer + otro + #ventas + #anuladas) → Tarea 12. ✅
- Reporte "por fecha" con detalle → Tarea 11. ✅
- Confetti: mantener el de cada venta + sumar el de cierre → Tareas 6 (se mantiene) + 12 (se suma). ✅
- Anular venta (RPC inversa + soft-delete auditable + lista ventas de hoy) → Tareas 4, 13. ✅
- Quitar el confirmDialog de cada venta → Tarea 13. ✅
- Buscador + orden estable + favoritos congelados + precio al vuelo → Tarea 8. ✅
- Legibilidad AA + button:disabled → Tarea 9. ✅
- Dejar de refetchear por tap (manteniendo Realtime) → Tarea 9. ✅
- Idempotencia + timeout/AbortController + health-check real + helper de mutación → Tareas 6, 10. ✅
- Guardas de fetch (no mostrar `$0` falso como real): reporte-general con chequeo de `error` → Tarea 11 Step 3; helper `mutar` en escrituras de Inventario/Insumos → Tarea 10. ✅
- Zona horaria: cierre de caja y "por fecha" usan **fecha local** (`toLocaleDateString('en-CA')` / inicio de día local), no UTC, para que la caja de una feria que cierra de noche cuadre → Tareas 11, 12. ✅
- Supuesto de dispositivos: quedó "depende" → se **mantiene** el Realtime (Tarea 9 no lo remueve). ✅
- Microcopy autoexplicativo para usuaria no técnica (subtítulos/tooltips en cada control) → Tarea 14. ✅
- QA visual en navegador: consistencia, contraste AA, layout, + defectos detectados (nombres de feria invisibles, reporte general como link, carrito descentrado) → Tarea 15. ✅

**Nota de dependencia:** las Tareas 1-4 (SQL) deben aplicarse antes que cualquier tarea de frontend que llame al RPC nuevo (6, 7, 13). La Tarea 5 (costo) debe ir antes de que las ventas reales dependan del snapshot, pero puede ir después de la 3 sin bloquear.

**Type consistency:** la firma `confirmar_venta(p_feria_id, p_items, p_metodo_pago, p_descuento, p_client_venta_id)` se usa idéntica en Tareas 3, 6 y 7. `anular_venta(p_venta_id, p_motivo)` idéntica en Tareas 4 y 13. Estado de módulo de `vender.js` (`metodoPagoActual`, `clientVentaIdPendiente`, `descuentoActual`, `filtroBusqueda`, `rankingCongelado`, `feriaProductosActuales`, `combosActuales`) declarado una vez y reusado.

---

## Fuera de alcance de este plan (SHOULD / v3 — no incluido, ver definición v2)

Estas quedan como segunda ola; **no** las implementa este plan: UI de rentabilidad (Ingreso/Costo/Ganancia/%), botón "+ Monto libre" en Vender (el RPC ya lo soporta), cola offline (IndexedDB) + PWA instalable, reportes que enseñan (ticket promedio, comparación entre ediciones, hora pico, productos sin salida, insumos por reponer), panel de carrito que no tape filas + calculadora de vuelto, steppers −/+ y persistir carrito en localStorage, rediseño de la fila de Inventario + modal para crear feria (reemplazar `prompt()`), combo-picker con fotos, insumo crítico vs no crítico, ajuste de stock por delta/RPC, `escapeHtml` + pin exacto de supabase-js + más tests, periwinkle como acento secundario.

## Execution Handoff

Plan completo y guardado en `docs/superpowers/plans/2026-07-11-feria-de-sofy-v2.md`.
