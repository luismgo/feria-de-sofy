# Feria de Sofy — Definición de la v2

> Producto de una revisión con panel de agentes expertos (producto, UX de venta
> en vivo, UI/diseño, ingeniería/confiabilidad, datos/negocio y un comodín
> fundador) sobre el código real de la v1, sintetizada, desafiada por un crítico
> adversarial e integrada. Las decisiones abiertas se cerraron con Luis.

Fecha: 2026-07-11 · v1 está en producción (https://luismgo.github.io/feria-de-sofy/)

---

## Veredicto sobre la v1

**v1 es un POS atómico y confiable que suma ingresos, pero es ciego a tres
cosas: la plata física, el costo y el error.**

Lo que hace bien y **no hay que romper**:
- Checkout atómico a prueba de sobreventa (`confirmar_venta`: `for update` +
  `update … where stock >= N`).
- Snapshots de nombre/precio en `venta_items` → los reportes sobreviven a
  borrados de catálogo.
- Carrito en cliente, "Disponible" que descuenta lo ya puesto en el carrito, y
  sync de stock en vivo entre dispositivos.

Dónde se queda corta (temas de mayor consenso del panel):
1. **Ciega al dinero físico** — no registra cómo se pagó; no se puede cuadrar
   efectivo vs transferencia al cierre; el reporte "por fecha" es un `<details>`
   vacío por dentro (`reportes.js:62`).
2. **Ciega al costo** — productos e insumos no tienen costo; los reportes son
   "vanidad de ingresos"; un combo top-ventas puede perder plata sin que se sepa.
3. **No perdona el error** — un mis-tap en vivo queda mal para siempre y
   descuadra stock; sólo se arregla por SQL (5/6 lentes lo marcaron).
4. **Frena el cobro** — 53+ productos sin buscador ni orden estable; el botón
   del RPC se cuelga con red lenta (`vender.js:167`, sin timeout).

---

## La apuesta central de la v2

> **"Que la caja cuadre."**

Principio rector (corrección clave del crítico): **método de pago, costo,
descuento e idempotencia son el mismo patrón** — agregar un campo + snapshot al
vender. Se **toca la función del dinero (`confirmar_venta` / `venta_items`) UNA
sola vez**, con tests de integración *antes* de tocarla, no en tres releases. El
histórico de costo/pago no se reconstruye: si no se snapshotea desde el día 1,
se pierde para siempre. Por eso las *columnas y el snapshot arrancan ya* aunque
la UI que los consume llegue después.

## Decisiones cerradas con Luis

| # | Decisión | Respuesta | Consecuencia para v2 |
|---|---|---|---|
| Núcleo | ¿Apuesta central? | **Que la caja cuadre** | Pago + cierre + anular + buscador en el must |
| Dispositivos | ¿Cuántos cobran a la vez? | **Depende / no seguro** | Se **mantiene** el Realtime y la sincronización entre celulares (no se remueve); la idempotencia protege además los reintentos del mismo device |
| Formas de pago | ¿Cómo pagan? | **Efectivo, Transferencia/MercadoPago, QR** (sin tarjeta) | Enum `efectivo / transferencia / otro` (QR → "otro"); cierre con esos tres cortes |
| Conexión | ¿Cómo anda la señal? | **Anda, con baches** | Piso de confiabilidad barato en el must; cola offline + PWA a v3 |

---

## Alcance v2 (MoSCoW)

### MUST — el núcleo "que la caja cuadre"

**1. Un solo pass de la función del dinero** (con tests de integración del RPC
*antes* de tocarlo). En una sola migración, `confirmar_venta` / `venta_items` /
`ventas` incorporan:
- `metodo_pago` en `ventas`: enum `efectivo | transferencia | otro`.
- `costo_unitario` snapshot en `venta_items` (leído de `productos.costo` +
  Σ costo de insumos de su receta al momento de vender).
- `descuento` por monto en `ventas` (para que el cierre cuadre ante un regateo).
- `client_venta_id uuid unique` (idempotencia: `on conflict do nothing` y
  devolver la venta existente).
- Soporte de **línea de monto libre** (`tipo='manual'`, sin `producto_id`,
  `producto_nombre` + `precio_unitario` a mano, sin mover stock).

**2. Dato de costo** editable en `productos` e `insumos` (`costo numeric`) — sólo
el schema y el input en Inventario; la UI de rentabilidad es *should*. Necesario
para que el snapshot de costo del pass único tenga de dónde leer.

**3. Método de pago con un tap** al confirmar la venta (efectivo / transferencia
/ otro), viajando por el RPC.

**4. Descuento por monto por venta** en el panel del carrito, antes de confirmar,
guardado en la venta (sin él, cada regateo genera un faltante fantasma al cierre).

**5. Cerrar caja (por día):** esperado en efectivo (neto de descuentos) vs
**contado** (input) → diferencia; total transferencia; total otro; # ventas;
# anuladas.

**6. Reporte "por fecha" con detalle:** llenar el `<details>` vacío con las
ventas del día una por una (hora, ítems, total, método) y totales por método.

**7. Confetti:** mantener el de **cada venta** y **sumar** una celebración mayor
al cerrar caja que cuadra ("¡Cuadraste con $X!"). Sumar, no mudar.

**8. Anular venta:** RPC inversa `anular_venta(venta_id, motivo)` que **repone**
stock de productos e insumos en una transacción (inversa del checkout), **nunca
DELETE**. Soft-delete con `anulada / anulada_at / anulada_by = auth.uid() /
motivo` en el **mismo** must (sin esas columnas no hay auditoría en un device
compartido). Lista "ventas de hoy" + botón "anular última". Todos los reportes y
el cierre filtran anuladas y muestran "# anuladas".

**9. Quitar el `confirmDialog` de cada venta** una vez que existe el undo/anular
(cobra el premio de velocidad de la acción de mayor frecuencia; hoy `vender.js:156`
es un tap-impuesto cuya única razón de ser es que no hay red de seguridad).

**10. Buscador + orden estable en Vender:** filtro por nombre en cliente +
`.order()` alfabético estable por defecto (hoy `vender.js:29` no tiene `.order()`)
+ "más vendidos/favoritos" arriba con **ranking congelado por sesión** (calculado
una vez al abrir la feria — no reordena a media fila) + fijar precio al vuelo
desde la tarjeta para productos sin categoría (hoy quedan invendibles).

**11. Legibilidad al aire libre como requisito funcional:** contraste AA en
precio y CTA (tokens `--accent-text` sobre `--accent-bg`; hoy ≈3.3:1, ilegible al
sol) + regla global `button:disabled` / `.btn:disabled`.

**12. Dejar de refetchear todo por cada tap:** recalcular "Disponible" en cliente
sin reconstruir las 53 tarjetas (`refrescarCarrito → loadAndRender`, `vender.js:110`),
**manteniendo** la subscripción Realtime para reconciliar entre dispositivos
(porque el nº de celulares quedó incierto).

**13b. Microcopy autoexplicativo (usuaria no técnica):** Sofy solo RECIBE la app, no la hizo ni tiene a quién preguntarle en la feria. Cada control nuevo de la v2 (método de pago, descuento, cerrar caja, anular, buscador, costo, receta) y las pantallas existentes llevan subtítulo / texto de ayuda inline y/o tooltip que explica qué hacen. Se implementa como una pasada dedicada de microcopy (Tarea 14 del plan), escrita al final contra la UI ya completa.

**13c. Consistencia visual y contraste (verificación real en navegador):** la app se la queda Sofy; no basta con que el código "parezca correcto", hay que **abrirla en el navegador y mirarla**. Pasada de QA visual contra la UI viva (localhost y móvil) que revisa contraste legible (AA), que todos los controles del mismo rango se vean como parte del mismo diseño (mismos botones, no unos con estilo y otros como link suelto), y que el layout no quede descuadrado. Defectos ya detectados que esta pasada debe cerrar: (a) **los nombres de las ferias no son visibles** (contraste/color) en la pantalla de selección de feria; (b) el **"Reporte general" es texto-con-link, no un botón** como todo lo demás; (c) en **Vender, el panel del carrito de abajo no está centrado**. Más "seguro más cosas de UI" que aparezcan al revisar en vivo. Se implementa como una pasada dedicada de QA visual (Tarea 15 del plan), corrida por el controlador en el navegador contra la UI ya completa.

**13. Piso de confiabilidad barato:** `client_venta_id` (ya en el pass) +
`timeout/AbortController` en la llamada al RPC con revert de `btn.disabled` y
toast de reintento (arregla el **botón colgado**) + health-check real (ping a
Supabase) para el banner en vez de `navigator.onLine` (que no detecta
wifi-conectado-sin-internet) + helper central de mutación que capture errores y
muestre toast (no más escrituras que fallan en silencio) + guardas de `fetch`
que muestren error en vez de crashear o mostrar `$0` falso como real.

### SHOULD — segunda ola (cuando el núcleo esté sólido)

- **UI de rentabilidad:** Ingreso / Costo / Ganancia / % de margen lado a lado en
  todos los reportes (el snapshot de costo ya arrancó en el must → histórico
  correcto). "Más vendidos" se vuelve "los que más plata dejan".
- **Botón "+ Monto libre"** en Vender (usa la línea-sin-producto ya soportada en
  el RPC); además permite registrar al cierre las ventas hechas a mano durante un
  corte de señal.
- **Reportes que enseñan:** ticket promedio, comparación entre ediciones de una
  misma feria con delta %, hora pico, productos sin salida, insumos por reponer —
  datos que ya existen y hoy se tiran.
- **Panel de carrito que no tape las filas** de productos + **calculadora de
  vuelto** co-ubicada (deciden el layout inferior juntas; validar el vuelto en la
  feria de comida). Steppers −/+ por línea (targets ≥44px), persistir carrito en
  `localStorage` por feria, confirmación al salir con carrito armado.
- **Endurecimiento base:** `escapeHtml` en datos de usuario, **pin exacto** de
  `supabase-js` (hoy `@2` flotante es riesgo de caída en plena feria), tests de
  integración del RPC (pgTAP o script).
- **Rediseño de la fila de Inventario** (dos niveles o menú ⋯; separar ➖ "quitar
  de feria" de 🗑️ "eliminar global" con tratamiento de peligro) + **modal propio
  para crear feria** (reemplaza los `prompt()` nativos) + quitar `maximum-scale=1.0`.
- **Combo-picker con fotos** + mismo buscador + steppers para duplicados.
- **Insumo "crítico" vs "no crítico":** que el faltante de un empaque trivial
  (bolsita) advierta y no aborte la venta.
- **Ajuste de stock por delta/RPC** con validación (evita lost-update e "input
  vacío = 0") + soft-delete y `created_by/updated_by` en productos/insumos.
- **Periwinkle** como acento semántico secundario (combos, "Hoy", chips) + tokens
  `--danger/--warning/--success` + mini escala tipográfica.

### WON'T — explícitamente fuera de v2 (para no inflar el scope)

- Roles/permisos (RBAC) y UI para la whitelist: sigue manual en Supabase.
- **Modo offline-first completo (cola optimista IndexedDB + PWA instalable):**
  va a **v3**. El piso barato del must + el monto libre tapan el hueco mientras
  tanto; la señal "con baches" no lo justifica todavía.
- E-commerce / pasarela online / pre-pedidos por WhatsApp / catálogo público:
  producto nuevo y más grande, apuesta de v3.
- CRM de clientes, recibos formales/fiscales, multi-tenant "para otros vendedores".
- Más inversión en el catálogo global compartido sin validar antes si las ferias
  comparten productos físicos.
- Inventario por-feria / cambio del modelo de stock global.
- Costeo por lotes / promedio móvil ponderado (el costo fijo editable alcanza el 90%).
- Reescritura a framework; abandonar vanilla-sin-build.
- Integraciones nativas de cobro (QR/MercadoPago/tarjeta): el enum "otro" las
  absorbe hasta que haya demanda real.
- Descuento / precio libre **por línea** (el ajuste por monto por venta alcanza).
- Esconder/rotar la anon key: está bien que viva en el cliente; el trabajo de
  seguridad real es RLS, no ocultar la publishable key.

---

## Cambios de schema concretos (el "pass único" del dinero)

```sql
-- productos / insumos: costo editable (must #2)
alter table productos add column costo numeric not null default 0;
alter table insumos   add column costo numeric not null default 0;

-- ventas: pago, descuento, idempotencia, soft-delete/anulación
alter table ventas add column metodo_pago text not null default 'efectivo'
  check (metodo_pago in ('efectivo','transferencia','otro'));
alter table ventas add column descuento numeric not null default 0;
alter table ventas add column client_venta_id uuid unique;      -- idempotencia
alter table ventas add column anulada boolean not null default false;
alter table ventas add column anulada_at timestamptz;
alter table ventas add column anulada_by uuid;
alter table ventas add column motivo_anulacion text;

-- venta_items: snapshot de costo + línea de monto libre
alter table venta_items add column costo_unitario numeric;      -- snapshot al vender
alter table venta_items drop constraint venta_items_tipo_check;
alter table venta_items add  constraint venta_items_tipo_check
  check (tipo in ('producto','combo','manual'));                -- 'manual' = monto libre
```

- `confirmar_venta(p_feria_id, p_items, p_metodo_pago, p_descuento, p_client_venta_id)`:
  idempotente por `client_venta_id`; snapshotea `costo_unitario` (costo del
  producto + Σ costo de insumos de su receta × cantidad); soporta líneas
  `tipo='manual'` (no mueven stock); aplica `descuento` al total.
- Nueva `anular_venta(p_venta_id, p_motivo)`: repone stock de productos e insumos
  en una transacción y marca `anulada`, `anulada_by=auth.uid()`, `anulada_at`,
  `motivo`. Nunca borra filas.
- Reportes y cierre: `where not anulada`.

## Riesgos y secuencia sugerida

1. **Primero los tests de integración del RPC** (pgTAP o script contra un proyecto
   Supabase de prueba) — es el código que todas las lentes piden no romper.
2. **Migración única** de schema + `confirmar_venta` ampliada + `anular_venta`.
3. UI de cobro: método de pago, descuento, buscador/orden, contraste, quitar el
   `confirm`, dejar de refetchear.
4. Cierre de caja + reporte "por fecha" con detalle + celebración de cierre.
5. Piso de confiabilidad (timeout/health-check/helper de mutación).
6. Recién entonces la segunda ola (rentabilidad, monto libre, reportes que enseñan…).

Riesgo principal a vigilar: que el pass del RPC se disperse en varias migraciones
(re-abre la superficie de riesgo tres veces). Mantenerlo como una sola migración
testeada es el corazón de esta versión.
