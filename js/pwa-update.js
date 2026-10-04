// ============================================================
// Ciclo de vida y actualización del Service Worker en la PWA.
// Detecta cuando hay una versión nueva esperando y muestra un popup
// flotante para recargar sin perder datos de la sesión ni interrumpir
// cobros accidentales.
// ============================================================

let controladorActivo = null;

export function crearControladorActualizacion({
  serviceWorker = typeof navigator !== 'undefined' ? navigator.serviceWorker : null,
  windowObj = typeof window !== 'undefined' ? window : null,
  documentObj = typeof document !== 'undefined' ? document : null,
  swUrl = './sw.js',
  onMostrarPopup = () => {},
  onOcultarPopup = () => {},
  fetchFn = typeof fetch !== 'undefined' ? fetch : null,
} = {}) {
  let registration = null;
  let waitingWorker = null;
  let recargando = false;
  let desestimado = false;
  let tagInicial = null;

  async function obtenerTagServidor() {
    if (!fetchFn) return null;
    try {
      const res = await fetchFn('.', { method: 'HEAD', cache: 'no-cache' });
      return res.headers?.get('etag') || res.headers?.get('last-modified') || null;
    } catch {
      return null;
    }
  }

  function mostrar() {
    if (desestimado) return;
    onMostrarPopup();
  }

  function ocultar() {
    desestimado = true;
    onOcultarPopup();
  }

  function aplicar() {
    if (recargando) return;
    if (waitingWorker) {
      waitingWorker.postMessage({ type: 'SKIP_WAITING' });
      // Fallback si controllerchange no dispara en un lapso razonable
      if (windowObj) {
        setTimeout(() => {
          if (!recargando) {
            recargando = true;
            windowObj.location.reload();
          }
        }, 1200);
      }
    } else if (windowObj) {
      recargando = true;
      windowObj.location.reload();
    }
  }

  async function chequear() {
    if (!serviceWorker) return;
    try {
      if (registration) {
        await registration.update();
      }
      if (fetchFn) {
        const nuevoTag = await obtenerTagServidor();
        if (nuevoTag && tagInicial && nuevoTag !== tagInicial) {
          mostrar();
        }
      }
    } catch {
      // Fallo de red o sin conexión: ignorar en silencio
    }
  }

  function registrarListeners(reg) {
    registration = reg;

    // Si ya había un worker esperando antes de registrar listeners
    if (reg.waiting) {
      waitingWorker = reg.waiting;
      mostrar();
      return;
    }

    reg.addEventListener('updatefound', () => {
      const nuevo = reg.installing;
      if (!nuevo) return;
      nuevo.addEventListener('statechange', () => {
        if (nuevo.state === 'installed' && serviceWorker.controller) {
          waitingWorker = nuevo;
          mostrar();
        }
      });
    });
  }

  async function iniciar() {
    if (!serviceWorker) return;

    serviceWorker.addEventListener('controllerchange', () => {
      if (recargando) return;
      recargando = true;
      if (windowObj) windowObj.location.reload();
    });

    try {
      tagInicial = await obtenerTagServidor();
      const reg = await serviceWorker.register(swUrl, { updateViaCache: 'none' });
      registrarListeners(reg);
    } catch (err) {
      console.warn('[PWA] No se pudo registrar el service worker:', err);
    }

    // Chequeo periódico (cada 1 hora)
    if (windowObj && windowObj.setInterval) {
      windowObj.setInterval(chequear, 60 * 60 * 1000);
    }

    // Chequeo al volver al frente (desbloquear celular o volver a la pestaña)
    if (documentObj && documentObj.addEventListener) {
      documentObj.addEventListener('visibilitychange', () => {
        if (documentObj.visibilityState === 'visible') chequear();
      });
    }

    if (windowObj && windowObj.addEventListener) {
      windowObj.addEventListener('online', chequear);
    }
  }

  return {
    iniciar,
    chequear,
    aplicar,
    ocultar,
    mostrar,
    getRegistration: () => registration,
    getWaitingWorker: () => waitingWorker,
    isRecargando: () => recargando,
    isDesestimado: () => desestimado,
  };
}

export function initPwaUpdate() {
  const popup = document.getElementById('update-popup');
  const btnReload = document.getElementById('btn-update-reload');
  const btnDismiss = document.getElementById('btn-update-dismiss');

  controladorActivo = crearControladorActualizacion({
    swUrl: './sw.js',
    onMostrarPopup() {
      if (popup) popup.classList.remove('hidden');
    },
    onOcultarPopup() {
      if (popup) popup.classList.add('hidden');
    },
  });

  if (btnReload) {
    btnReload.addEventListener('click', () => {
      btnReload.disabled = true;
      btnReload.textContent = 'Actualizando...';
      if (btnDismiss) btnDismiss.disabled = true;
      controladorActivo.aplicar();
    });
  }

  if (btnDismiss) {
    btnDismiss.addEventListener('click', () => {
      controladorActivo.ocultar();
    });
  }

  controladorActivo.iniciar();
}

export function mostrarPopupActualizacion() {
  controladorActivo?.mostrar();
}

export function ocultarPopupActualizacion() {
  controladorActivo?.ocultar();
}

export function aplicarActualizacion() {
  controladorActivo?.aplicar();
}

export function descartarActualizacion() {
  controladorActivo?.ocultar();
}

export function chequearActualizacion() {
  return controladorActivo?.chequear();
}
