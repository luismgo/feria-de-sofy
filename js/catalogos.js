const TABLAS_POR_CATALOGO = {
  categorias: 'categorias_precio',
  combos: 'combos',
  productos: 'feria_productos',
};

export function borrarCatalogo(supabase, catalogo, feriaId) {
  const tabla = TABLAS_POR_CATALOGO[catalogo];
  if (!tabla) throw new Error(`Catálogo desconocido: ${catalogo}`);
  return supabase.from(tabla).delete().eq('feria_id', feriaId);
}
