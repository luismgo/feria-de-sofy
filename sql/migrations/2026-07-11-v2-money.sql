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
