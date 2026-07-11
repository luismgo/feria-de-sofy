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
