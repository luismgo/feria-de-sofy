import { supabase } from './supabaseClient.js';
import { toast, escapeHtml, abrirModal, cargando, emptyState } from './ui.js';

const EMOJIS_SUGERIDOS = ['🌸', '🎨', '🧵', '✨', '🧁', '🎄', '🎃', '💖'];

function slugify(nombre) {
  return nombre.toLowerCase().trim().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || `feria-${Math.random().toString(36).slice(2)}`;
}

export async function initFeriaSelector(onSelect) {
  const screen = document.getElementById('feria-selector');
  const cardsContainer = document.getElementById('feria-cards');
  const btnNueva = document.getElementById('btn-nueva-feria');

  screen.classList.remove('hidden');
  await render();

  btnNueva.onclick = () => abrirCrearFeria(render);

  async function render() {
    cardsContainer.innerHTML = cargando('Cargando tus ferias...');
    const { data: ferias, error } = await supabase.from('ferias').select('*').order('nombre');
    if (error) {
      cardsContainer.innerHTML = '<p class="error">No se pudieron cargar las ferias</p>';
      return;
    }
    cardsContainer.innerHTML = '';
    if (ferias.length === 0) {
      cardsContainer.innerHTML = emptyState('🌸', 'Todavía no hay ferias', 'Creá la primera con el botón de abajo.');
      return;
    }
    ferias.forEach((feria) => {
      const card = document.createElement('button');
      card.className = 'feria-card';
      card.innerHTML = `
        <span class="feria-card__emoji" aria-hidden="true">${escapeHtml(feria.emoji)}</span>
        <span class="feria-card__nombre">${escapeHtml(feria.nombre)}</span>
        <svg class="icon" aria-hidden="true"><use href="#i-chevron"/></svg>`;
      card.addEventListener('click', () => {
        screen.classList.add('hidden');
        onSelect(feria);
      });
      cardsContainer.appendChild(card);
    });
  }
}

function abrirCrearFeria(onCreada) {
  let emojiSel = EMOJIS_SUGERIDOS[0];
  const { dialogo, cerrar } = abrirModal({
    titulo: 'Nueva feria',
    contenidoHTML: `
      <label class="field">
        <span class="field__label">Nombre de la feria</span>
        <input type="text" class="input" id="feria-nombre" placeholder="Ej: Feria de primavera" autofocus />
      </label>
      <div class="field">
        <span class="field__label">Emoji que la representa</span>
        <div class="emoji-picker" role="group" aria-label="Elegir emoji">
          ${EMOJIS_SUGERIDOS.map((e) => `
            <button type="button" class="emoji-picker__item ${e === emojiSel ? 'selected' : ''}" data-emoji="${e}" aria-label="Emoji ${e}">${e}</button>
          `).join('')}
        </div>
      </div>
      <div class="modal-actions">
        <button type="button" class="btn btn--secondary" data-action="cancelar">Cancelar</button>
        <button type="button" class="btn btn--primary" data-action="crear">Crear feria</button>
      </div>`,
  });

  dialogo.addEventListener('click', async (e) => {
    const emojiBtn = e.target.closest('[data-emoji]');
    if (emojiBtn) {
      emojiSel = emojiBtn.dataset.emoji;
      dialogo.querySelectorAll('.emoji-picker__item').forEach((b) => b.classList.toggle('selected', b.dataset.emoji === emojiSel));
      return;
    }
    const action = e.target.closest('[data-action]')?.dataset.action;
    if (action === 'cancelar') cerrar(null);
    if (action === 'crear') {
      const nombre = dialogo.querySelector('#feria-nombre').value.trim();
      if (!nombre) { toast('Poné un nombre para la feria.'); return; }
      const btn = e.target.closest('[data-action]');
      btn.disabled = true;
      const { error } = await supabase.from('ferias').insert({ nombre, emoji: emojiSel, slug: slugify(nombre) });
      if (error) {
        btn.disabled = false;
        toast('No se pudo crear la feria', { tipo: 'error' });
        return;
      }
      cerrar(true);
      toast('¡Feria creada! 🌸', { tipo: 'exito' });
      onCreada();
    }
  });
}
