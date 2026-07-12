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
