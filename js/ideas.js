import { supabase } from './supabaseClient.js';
import { confirmDialog } from './ui.js';

const TIPOS = { producto: '💡 Producto', logistica: '📋 Logística', precio: '💰 Precio/Promo' };

export function initIdeas(feria) {
  const container = document.getElementById('tab-ideas');
  container.innerHTML = '<p>Cargando ideas...</p>';
  render(feria, container, 'todos');
  return () => {};
}

async function render(feria, container, filtro) {
  const query = supabase.from('notas').select('*').eq('feria_id', feria.id).order('created_at', { ascending: false });
  const { data: notas } = filtro === 'todos' ? await query : await query.eq('tipo', filtro);

  container.innerHTML = `
    <div class="ideas-filtros">
      <button data-filtro="todos" class="${filtro === 'todos' ? 'active' : ''}">Todos</button>
      ${Object.entries(TIPOS).map(([key, label]) => `<button data-filtro="${key}" class="${filtro === key ? 'active' : ''}">${label}</button>`).join('')}
    </div>
    <div id="ideas-list" class="ideas-list">
      ${notas.map((n) => `
        <div class="idea-row ${n.hecho ? 'idea-row--hecho' : ''}" data-id="${n.id}">
          <input type="checkbox" data-action="toggle-hecho" data-id="${n.id}" ${n.hecho ? 'checked' : ''} />
          <span class="idea-tipo">${TIPOS[n.tipo]}</span>
          <span class="idea-texto">${n.texto}</span>
          <button class="btn-icon" data-action="eliminar-nota" data-id="${n.id}">🗑️</button>
        </div>
      `).join('') || '<p class="inv-empty">Sin notas todavía</p>'}
    </div>
    <form id="form-nota" class="inv-form">
      <select name="tipo">
        ${Object.entries(TIPOS).map(([key, label]) => `<option value="${key}">${label}</option>`).join('')}
      </select>
      <input name="texto" placeholder="Escribí tu idea..." required />
      <button type="submit">Agregar</button>
    </form>
  `;

  container.querySelectorAll('[data-filtro]').forEach((btn) => {
    btn.addEventListener('click', () => render(feria, container, btn.dataset.filtro));
  });

  container.querySelectorAll('[data-action="toggle-hecho"]').forEach((cb) => {
    cb.addEventListener('change', async () => {
      await supabase.from('notas').update({ hecho: cb.checked }).eq('id', cb.dataset.id);
    });
  });

  container.querySelectorAll('[data-action="eliminar-nota"]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const ok = await confirmDialog('¿Eliminar esta nota?');
      if (!ok) return;
      await supabase.from('notas').delete().eq('id', btn.dataset.id);
      render(feria, container, filtro);
    });
  });

  container.querySelector('#form-nota').addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.target;
    await supabase.from('notas').insert({ feria_id: feria.id, tipo: form.tipo.value, texto: form.texto.value.trim() });
    render(feria, container, filtro);
  });
}
