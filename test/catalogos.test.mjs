import assert from 'node:assert/strict';
import test from 'node:test';

let borrarCatalogo;
try {
  ({ borrarCatalogo } = await import('../js/catalogos.js'));
} catch {
  // La aserción de abajo muestra la ausencia de la función hasta implementarla.
}

function crearSupabaseFalso() {
  const llamadas = [];
  return {
    llamadas,
    from(tabla) {
      llamadas.push({ tabla });
      return {
        delete() {
          llamadas.at(-1).delete = true;
          return {
            eq(columna, valor) {
              llamadas.at(-1).filtro = { columna, valor };
              return Promise.resolve({ error: null });
            },
          };
        },
      };
    },
  };
}

test('limpia solo los registros de la feria en cada catálogo', async () => {
  assert.equal(typeof borrarCatalogo, 'function');

  const casos = [
    ['categorias', 'categorias_precio'],
    ['combos', 'combos'],
    ['productos', 'feria_productos'],
  ];

  for (const [catalogo, tabla] of casos) {
    const supabase = crearSupabaseFalso();
    await borrarCatalogo(supabase, catalogo, 'feria-123');
    assert.deepEqual(supabase.llamadas, [{
      tabla,
      delete: true,
      filtro: { columna: 'feria_id', valor: 'feria-123' },
    }]);
  }
});
