import { supabase } from './supabaseClient.js';
import { confirmDialog, mutar, escapeHtml, cargando, emptyState } from './ui.js';

const TIPOS = { producto: '💡 Producto', logistica: '📋 Logística', precio: '💰 Precio/Promo' };

export function initIdeas(feria) {
  const container = document.getElementById('tab-ideas');
  container.innerHTML = cargando('Cargando ideas...', { kind: 'lista' });
  render(feria, container, 'todos');
  return () => {};
}

// Cablea el FAB que lleva (scroll + foco) hasta el formulario de alta de idea, al final
// de la lista. Con muchas ideas anotadas, ese formulario queda lejos del punto donde
// la usuaria está mirando.
function bindFab(container, fabSel, formSel) {
  const fab = container.querySelector(fabSel);
  const form = container.querySelector(formSel);
  fab.addEventListener('click', () => {
    const behavior = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth';
    form.scrollIntoView({ behavior, block: 'center' });
    form.querySelector('input, select')?.focus({ preventScroll: true });
  });
}

async function render(feria, container, filtro) {
  const query = supabase.from('notas').select('*').eq('feria_id', feria.id).order('created_at', { ascending: false });
  const { data: notas, error } = filtro === 'todos' ? await query : await query.eq('tipo', filtro);

  if (error) {
    container.innerHTML = '<p class="error">No se pudieron cargar las ideas — revisá la conexión</p>';
    return;
  }

  container.innerHTML = `
    <div class="segmented segmented--scroll ideas-filtros" role="group" aria-label="Filtrar ideas">
      <button type="button" class="segmented__item ${filtro === 'todos' ? 'is-active' : ''}" data-filtro="todos">Todos</button>
      ${Object.entries(TIPOS).map(([key, label]) => `
        <button type="button" class="segmented__item ${filtro === key ? 'is-active' : ''}" data-filtro="${key}">${label}</button>
      `).join('')}
    </div>
    <div id="ideas-list" class="ideas-list">
      ${notas.map((n) => `
        <div class="idea-row ${n.hecho ? 'idea-row--hecho' : ''}" data-id="${n.id}">
          <label class="idea-check" title="Marcar como hecho">
            <input type="checkbox" data-action="toggle-hecho" data-id="${n.id}" ${n.hecho ? 'checked' : ''} aria-label="Marcar como hecho" />
          </label>
          <div class="idea-row__info">
            <span class="idea-texto">${escapeHtml(n.texto)}</span>
            <span class="idea-tipo">${TIPOS[n.tipo]}</span>
          </div>
          <button class="btn-accion btn-accion--peligro btn-accion--sm" data-action="eliminar-nota" data-id="${n.id}" title="Borrar esta idea">
            <svg class="icon" aria-hidden="true"><use href="#i-trash"/></svg> Borrar
          </button>
        </div>
      `).join('') || emptyState('💡', 'Sin ideas todavía', 'Anotá acá lo que se te ocurra en plena feria: productos, precios, pendientes.', 'ideas')}
    </div>
    <form id="form-nota" class="card form-nota">
      <label class="field">
        <span class="field__label">Nueva idea</span>
        <input name="texto" class="input" placeholder="Escribí tu idea..." required />
      </label>
      <div class="form-nota__fila">
        <label class="field form-nota__tipo">
          <span class="field__label">Tipo</span>
          <select name="tipo" class="input">
            ${Object.entries(TIPOS).map(([key, label]) => `<option value="${key}">${label}</option>`).join('')}
          </select>
        </label>
        <button type="submit" class="btn btn--primary">Agregar</button>
      </div>
    </form>

    <button type="button" class="ideas-fab" id="ideas-fab-nota" aria-label="Ir a agregar idea" title="Ir a agregar idea">
      <svg class="icon" aria-hidden="true"><use href="#i-mas"/></svg>
    </button>
  `;

  bindFab(container, '#ideas-fab-nota', '#form-nota');

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
