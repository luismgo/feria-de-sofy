import { supabase } from './supabaseClient.js';

let online = navigator.onLine;
let bannerEl = null;
let fallosSeguidos = 0;

async function ping() {
  if (!navigator.onLine) { fallosSeguidos = 0; setOnline(false); return; }
  try {
    const { error } = await supabase.from('ferias').select('id', { head: true, count: 'exact' });
    if (error) throw error;
    fallosSeguidos = 0;
    setOnline(true);
  } catch {
    // Un ping fallido puede ser un bache de wifi; recién marcamos "sin conexión" tras 2
    // fallos seguidos para no bloquear ventas legítimas en una feria con señal inestable.
    fallosSeguidos += 1;
    if (fallosSeguidos >= 2) setOnline(false);
  }
}

function setOnline(value) {
  online = value;
  if (bannerEl) bannerEl.classList.toggle('hidden', online);
}

export function initConnectionBanner() {
  bannerEl = document.getElementById('connection-banner');
  window.addEventListener('online', ping);
  window.addEventListener('offline', () => setOnline(false));
  ping();
  setInterval(ping, 20000); // re-chequeo periódico: detecta wifi conectado pero sin internet
}

export function isOnline() {
  return online;
}
