import { supabase } from './supabaseClient.js';
import { confirmDialog, mutar, escapeHtml } from './ui.js';

const TIPOS = { producto: '💡 Producto', logistica: '📋 Logística', precio: '💰 Precio/Promo' };

export function initIdeas(feria) {
  const container = document.getElementById('tab-ideas');
  container.innerHTML = '<p>Cargando ideas...</p>';
  render(feria, container, 'todos');
  return () => {};
}

async function render(feria, container, filtro) {
  const query = supabase.from('notas').select('*').eq('feria_id', feria.id).order('created_at', { ascending: false });
  const { data: notas, error } = filtro === 'todos' ? await query : await query.eq('tipo', filtro);

  if (error) {
    container.innerHTML = '<p class="error">No se pudieron cargar las ideas — revisá la conexión</p>';
    return;
  }

  container.innerHTML = `
    <div class="ideas-filtros">
      <button data-filtro="todos" class="${filtro === 'todos' ? 'active' : ''}">Todos</button>
      ${Object.entries(TIPOS).map(([key, label]) => `<button data-filtro="${key}" class="${filtro === key ? 'active' : ''}">${label}</button>`).join('')}
    </div>
    <div id="ideas-list" class="ideas-list">
      ${notas.map((n) => `
        <div class="idea-row ${n.hecho ? 'idea-row--hecho' : ''}" data-id="${n.id}">
          <input type="checkbox" data-action="toggle-hecho" data-id="${n.id}" ${n.hecho ? 'checked' : ''} title="Marcar como hecho" />
          <span class="idea-tipo">${TIPOS[n.tipo]}</span>
          <span class="idea-texto">${escapeHtml(n.texto)}</span>
          <button class="btn-accion btn-accion--peligro btn-accion--sm" data-action="eliminar-nota" data-id="${n.id}" title="Borrar esta idea">🗑️ Borrar</button>
        </div>
      `).join('') || '<p class="list-empty">Sin notas todavía</p>'}
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
      const { error } = await mutar(supabase.from('notas').update({ hecho: cb.checked }).eq('id', cb.dataset.id), 'No se pudo actualizar la idea');
      if (error) { cb.checked = !cb.checked; return; } // revertir el visual si no se guardó
      cb.closest('.idea-row')?.classList.toggle('idea-row--hecho', cb.checked);
    });
  });

  container.querySelectorAll('[data-action="eliminar-nota"]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const ok = await confirmDialog('¿Eliminar esta nota?', { peligro: true });
      if (!ok) return;
      const { error } = await mutar(supabase.from('notas').delete().eq('id', btn.dataset.id), 'No se pudo eliminar la idea');
      if (error) return;
      render(feria, container, filtro);
    });
  });

  container.querySelector('#form-nota').addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.target;
    const submitBtn = form.querySelector('button[type="submit"]');
    submitBtn.disabled = true;
    const { error } = await mutar(supabase.from('notas').insert({ feria_id: feria.id, tipo: form.tipo.value, texto: form.texto.value.trim() }), 'No se pudo agregar la idea');
    if (error) { submitBtn.disabled = false; return; }
    render(feria, container, filtro);
  });
}
