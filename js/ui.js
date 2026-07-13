export function confirmDialog(message, { peligro = false } = {}) {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal">
        <p>${message}</p>
        <div class="modal-actions">
          <button class="btn btn--secondary" data-action="no">Cancelar</button>
          <button class="btn ${peligro ? 'btn--peligro' : ''}" data-action="si">Confirmar</button>
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

// Escapa texto que viene de la usuaria (nombres, notas, emojis) antes de meterlo en innerHTML,
// para que una comilla o un < no rompan el render ni el atributo.
export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

// Formatea un monto en pesos con separador de miles (ej. 1234 -> "$1.234").
// Locale es-CO: separador de miles con PUNTO, como se lee la plata en Colombia.
export function formatMoney(n) {
  return '$' + Number(n || 0).toLocaleString('es-CO');
}

// UUID con fallback: crypto.randomUUID sólo existe en contexto seguro (https/localhost);
// servida por IP en la LAN (http plano) tiraría excepción, así que caemos a un generador propio.
export function uuid() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

// Modal temático para pedir un texto (reemplaza a prompt(), que rompe el tema y es hostil en touch).
// Resuelve con el string ingresado, o null si se cancela.
export function promptDialog(message, { placeholder = '', value = '', okLabel = 'Guardar', tipo = 'text' } = {}) {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal">
        <p>${escapeHtml(message)}</p>
        <input class="prompt-input" type="${tipo}" placeholder="${escapeHtml(placeholder)}" value="${escapeHtml(value)}" />
        <div class="modal-actions">
          <button class="btn btn--secondary" data-action="no">Cancelar</button>
          <button class="btn" data-action="si">${escapeHtml(okLabel)}</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
    const input = overlay.querySelector('.prompt-input');
    input.focus();

    const done = (val) => { document.body.removeChild(overlay); resolve(val); };
    overlay.addEventListener('click', (e) => {
      const action = e.target.dataset.action;
      if (action === 'no') done(null);
      if (action === 'si') done(input.value);
    });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); done(input.value); }
      if (e.key === 'Escape') done(null);
    });
  });
}
