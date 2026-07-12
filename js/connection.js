import { supabase } from './supabaseClient.js';

let online = navigator.onLine;
let bannerEl = null;

async function ping() {
  if (!navigator.onLine) { setOnline(false); return; }
  try {
    const { error } = await supabase.from('ferias').select('id', { head: true, count: 'exact' });
    setOnline(!error);
  } catch {
    setOnline(false);
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
