// Uso: SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/comprimir-fotos.mjs
// Recomprime las fotos ya subidas al bucket "productos-fotos": vienen del excel de
// importación sin comprimir (~500KB-1MB) para mostrarse en miniaturas de 40-90px.
// Redimensiona al lado mayor y reencoda a JPEG, sobrescribiendo el mismo path
// (mismo imagen_url, no hay que tocar la base de datos).

import sharp from 'sharp';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const BUCKET = 'productos-fotos';
const MAX_DIM = 800;
const CALIDAD = 80;
const SALTAR_SI_MENOR_A = 150 * 1024; // ya comprimida (subida por la app): no reprocesar

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error('Faltan SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY en el entorno');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

async function main() {
  const { data: archivos, error } = await supabase.storage.from(BUCKET).list('', { limit: 1000 });
  if (error) {
    console.error('No se pudo listar el bucket:', error.message);
    process.exit(1);
  }

  let totalAntes = 0;
  let totalDespues = 0;
  let procesadas = 0;
  let saltadas = 0;

  for (const archivo of archivos) {
    const pesoOriginal = archivo.metadata?.size ?? 0;
    if (pesoOriginal > 0 && pesoOriginal < SALTAR_SI_MENOR_A) {
      saltadas++;
      continue;
    }

    const { data: blob, error: dlError } = await supabase.storage.from(BUCKET).download(archivo.name);
    if (dlError) {
      console.warn(`No se pudo descargar "${archivo.name}":`, dlError.message);
      continue;
    }

    const buffer = Buffer.from(await blob.arrayBuffer());
    const comprimido = await sharp(buffer)
      .resize(MAX_DIM, MAX_DIM, { fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: CALIDAD })
      .toBuffer();

    if (comprimido.length >= buffer.length) {
      saltadas++;
      continue; // ya era más chica que el resultado comprimido: no vale la pena tocarla
    }

    const { error: upError } = await supabase.storage
      .from(BUCKET)
      .upload(archivo.name, comprimido, { contentType: 'image/jpeg', upsert: true });

    if (upError) {
      console.warn(`No se pudo re-subir "${archivo.name}":`, upError.message);
      continue;
    }

    totalAntes += buffer.length;
    totalDespues += comprimido.length;
    procesadas++;
    console.log(`✓ ${archivo.name}: ${(buffer.length / 1024).toFixed(0)}KB → ${(comprimido.length / 1024).toFixed(0)}KB`);
  }

  console.log(`\nListo: ${procesadas} recomprimidas, ${saltadas} sin tocar.`);
  if (procesadas > 0) {
    console.log(`Peso: ${(totalAntes / 1024 / 1024).toFixed(1)}MB → ${(totalDespues / 1024 / 1024).toFixed(1)}MB`);
  }
}

main();
