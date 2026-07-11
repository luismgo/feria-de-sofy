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
