import { supabase } from './supabaseClient.js';
import { toast, escapeHtml, promptDialog } from './ui.js';

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

  btnNueva.onclick = async () => {
    const nombre = await promptDialog('Nombre de la nueva feria:', { placeholder: 'Ej: Feria de primavera', okLabel: 'Siguiente' });
    if (!nombre || !nombre.trim()) return;
    const emoji = (await promptDialog('Un emoji para representarla:', { value: '🌸', okLabel: 'Crear feria' })) || '🌸';
    const { error } = await supabase.from('ferias').insert({ nombre: nombre.trim(), emoji: emoji.trim(), slug: slugify(nombre) });
    if (error) {
      toast('No se pudo crear la feria');
      return;
    }
    toast('¡Feria creada! 🌸');
    await render();
  };

  async function render() {
    cardsContainer.innerHTML = '<p>Cargando...</p>';
    const { data: ferias, error } = await supabase.from('ferias').select('*').order('nombre');
    if (error) {
      cardsContainer.innerHTML = '<p class="error">No se pudieron cargar las ferias</p>';
      return;
    }
    cardsContainer.innerHTML = '';
    ferias.forEach((feria) => {
      const card = document.createElement('button');
      card.className = 'feria-card';
      card.innerHTML = `<span class="feria-card__emoji">${escapeHtml(feria.emoji)}</span><span class="feria-card__nombre">${escapeHtml(feria.nombre)}</span>`;
      card.addEventListener('click', () => {
        screen.classList.add('hidden');
        onSelect(feria);
      });
      cardsContainer.appendChild(card);
    });
  }
}
