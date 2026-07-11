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
