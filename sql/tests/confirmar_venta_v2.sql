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
