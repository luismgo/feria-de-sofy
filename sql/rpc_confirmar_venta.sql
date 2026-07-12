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
