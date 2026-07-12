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
