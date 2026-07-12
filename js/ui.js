export function confirmDialog(message) {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal">
        <p>${message}</p>
        <div class="modal-actions">
          <button class="btn btn--secondary" data-action="no">Cancelar</button>
          <button class="btn" data-action="si">Confirmar</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    overlay.addEventListener('click', (e) => {
      const action = e.target.dataset.action;
      if (!action) return;
      document.body.removeChild(overlay);
      resolve(action === 'si');
    });
  });
}

export function toast(message) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = message;
  document.body.appendChild(el);
  setTimeout(() => el.classList.add('toast--visible'), 10);
  setTimeout(() => {
    el.classList.remove('toast--visible');
    setTimeout(() => el.remove(), 300);
  }, 2500);
}

// Ejecuta una escritura de Supabase y avisa por toast si falla, en vez de fallar en silencio.
export async function mutar(promesa, mensajeError = 'No se pudo guardar el cambio') {
  const { data, error } = await promesa;
  if (error) {
    toast(mensajeError);
    console.error(mensajeError, error);
  }
  return { data, error };
}
