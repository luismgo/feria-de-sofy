export function initConnectionBanner() {
  const banner = document.getElementById('connection-banner');

  function update() {
    banner.classList.toggle('hidden', navigator.onLine);
  }

  window.addEventListener('online', update);
  window.addEventListener('offline', update);
  update();
}

export function isOnline() {
  return navigator.onLine;
}
