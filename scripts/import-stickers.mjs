// Uso: SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/import-stickers.mjs
// Corre desde la raíz del repo (lee insumos/Inventario stickers.xlsx con ruta relativa).

import ExcelJS from 'exceljs';
import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';
import path from 'node:path';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error('Faltan SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY en el entorno');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
const BUCKET = 'productos-fotos';

async function main() {
  const { data: feria, error: feriaError } = await supabase
    .from('ferias').select('id').eq('slug', 'stickers').single();

  if (feriaError || !feria) {
    console.error('No se encontró la feria "stickers". Corré primero sql/seed.sql.');
    process.exit(1);
  }

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(path.resolve('insumos/Inventario stickers.xlsx'));
  const sheet = workbook.worksheets[0];
  const images = sheet.getImages();

  let creados = 0;
  for (let rowNumber = 4; rowNumber <= sheet.rowCount; rowNumber++) {
    const row = sheet.getRow(rowNumber);
    const nombre = row.getCell(3).value; // columna C: Nombre
    const cantidad = row.getCell(4).value; // columna D: Cantidad

    if (!nombre) continue;

    let imagenUrl = null;
    const imagen = images.find((img) => {
      const filaSuperior = img.range.tl.row;
      const filaInferior = img.range.br ? img.range.br.row : filaSuperior;
      return filaSuperior <= rowNumber - 1 && filaInferior >= rowNumber - 1;
    });
    if (imagen) {
      const img = workbook.getImage(imagen.imageId);
      const fileName = `${randomUUID()}.${img.extension}`;
      const { error: uploadError } = await supabase.storage
        .from(BUCKET)
        .upload(fileName, Buffer.from(img.buffer), { contentType: `image/${img.extension}` });

      if (!uploadError) {
        imagenUrl = supabase.storage.from(BUCKET).getPublicUrl(fileName).data.publicUrl;
      } else {
        console.warn(`No se pudo subir la foto de "${nombre}":`, uploadError.message);
      }
    }

    const { data: producto, error: insertError } = await supabase
      .from('productos')
      .insert({ nombre: String(nombre).trim(), stock: Number(cantidad) || 0, imagen_url: imagenUrl })
      .select()
      .single();

    if (insertError) {
      console.warn(`No se pudo crear el producto "${nombre}":`, insertError.message);
      continue;
    }

    await supabase.from('feria_productos').insert({ feria_id: feria.id, producto_id: producto.id });

    creados++;
    console.log(`✓ ${nombre} (stock: ${cantidad})`);
  }

  console.log(`\nListo: ${creados} productos creados.`);
}

main();
