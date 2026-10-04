import assert from 'node:assert/strict';
import test from 'node:test';
import { crearControladorActualizacion } from '../js/pwa-update.js';

function crearMockServiceWorker() {
  const listeners = {};
  let controller = { id: 'sw-v1' };

  return {
    controller,
    setController(c) { controller = c; this.controller = c; },
    addEventListener(event, fn) {
      listeners[event] = listeners[event] || [];
      listeners[event].push(fn);
    },
    disparar(event, data) {
      (listeners[event] || []).forEach((fn) => fn(data));
    },
    async register(url, opts) {
      return this.mockRegistration;
    },
    mockRegistration: null,
  };
}

function crearMockRegistration() {
  const listeners = {};
  let updateCalled = false;
  return {
    waiting: null,
    installing: null,
    updateCalled: () => updateCalled,
    async update() { updateCalled = true; },
    addEventListener(event, fn) {
      listeners[event] = listeners[event] || [];
      listeners[event].push(fn);
    },
    disparar(event, data) {
      (listeners[event] || []).forEach((fn) => fn(data));
    },
  };
}

test('detecta worker en estado waiting existente al iniciar y muestra el popup', async () => {
  let popupMostrado = false;
  const mockSw = crearMockServiceWorker();
  const mockReg = crearMockRegistration();
  mockReg.waiting = { id: 'sw-v2', postMessage() {} };
  mockSw.mockRegistration = mockReg;

  const ctrl = crearControladorActualizacion({
    serviceWorker: mockSw,
    onMostrarPopup() { popupMostrado = true; },
  });

  await ctrl.iniciar();

  assert.equal(popupMostrado, true);
  assert.equal(ctrl.getWaitingWorker(), mockReg.waiting);
});

test('detecta updatefound y estado installed con controller activo', async () => {
  let popupMostrado = false;
  const mockSw = crearMockServiceWorker();
  const mockReg = crearMockRegistration();
  mockSw.mockRegistration = mockReg;

  const ctrl = crearControladorActualizacion({
    serviceWorker: mockSw,
    onMostrarPopup() { popupMostrado = true; },
  });

  await ctrl.iniciar();
  assert.equal(popupMostrado, false);

  const workerStateListeners = {};
  const nuevoWorker = {
    id: 'sw-nuevo',
    state: 'installing',
    addEventListener(evt, fn) {
      workerStateListeners[evt] = workerStateListeners[evt] || [];
      workerStateListeners[evt].push(fn);
    },
    postMessage() {},
  };

  mockReg.installing = nuevoWorker;
  mockReg.disparar('updatefound');

  // Pasa a installed
  nuevoWorker.state = 'installed';
  (workerStateListeners['statechange'] || []).forEach((fn) => fn());

  assert.equal(popupMostrado, true);
  assert.equal(ctrl.getWaitingWorker(), nuevoWorker);
});

test('aplicar() envía SKIP_WAITING al worker en espera', async () => {
  const mockSw = crearMockServiceWorker();
  const mockReg = crearMockRegistration();
  const mensajesEnviados = [];
  const waitingWorker = {
    id: 'sw-v2',
    postMessage(msg) { mensajesEnviados.push(msg); },
  };
  mockReg.waiting = waitingWorker;
  mockSw.mockRegistration = mockReg;

  const ctrl = crearControladorActualizacion({
    serviceWorker: mockSw,
  });

  await ctrl.iniciar();
  ctrl.aplicar();

  assert.deepEqual(mensajesEnviados, [{ type: 'SKIP_WAITING' }]);
});

test('ocultar() desestima el popup para la sesión actual', async () => {
  let popupMostrado = 0;
  let popupOcultado = 0;
  const mockSw = crearMockServiceWorker();
  const mockReg = crearMockRegistration();
  mockSw.mockRegistration = mockReg;

  const ctrl = crearControladorActualizacion({
    serviceWorker: mockSw,
    onMostrarPopup() { popupMostrado += 1; },
    onOcultarPopup() { popupOcultado += 1; },
  });

  await ctrl.iniciar();
  ctrl.mostrar();
  assert.equal(popupMostrado, 1);

  ctrl.ocultar();
  assert.equal(popupOcultado, 1);
  assert.equal(ctrl.isDesestimado(), true);

  // Intentar mostrar de nuevo estando desestimado no hace nada
  ctrl.mostrar();
  assert.equal(popupMostrado, 1);
});

test('chequear() detecta cambio de ETag/deploy en el servidor y muestra popup', async () => {
  let popupMostrado = false;
  const mockSw = crearMockServiceWorker();
  const mockReg = crearMockRegistration();
  mockSw.mockRegistration = mockReg;

  let etagActual = 'tag-v1';
  const fetchMock = async () => ({
    headers: {
      get(name) {
        if (name === 'etag') return etagActual;
        return null;
      },
    },
  });

  const ctrl = crearControladorActualizacion({
    serviceWorker: mockSw,
    fetchFn: fetchMock,
    onMostrarPopup() { popupMostrado = true; },
  });

  await ctrl.iniciar();
  assert.equal(popupMostrado, false);

  // Servidor entrega un nuevo tag (nuevo commit deployado)
  etagActual = 'tag-v2';
  await ctrl.chequear();

  assert.equal(popupMostrado, true);
  assert.equal(mockReg.updateCalled(), true);
});

test('controllerchange dispara reload de ventana', async () => {
  let reloadLlamado = false;
  const mockSw = crearMockServiceWorker();
  const mockReg = crearMockRegistration();
  mockSw.mockRegistration = mockReg;

  const mockWindow = {
    location: {
      reload() { reloadLlamado = true; },
    },
  };

  const ctrl = crearControladorActualizacion({
    serviceWorker: mockSw,
    windowObj: mockWindow,
  });

  await ctrl.iniciar();
  mockSw.disparar('controllerchange');

  assert.equal(reloadLlamado, true);
  assert.equal(ctrl.isRecargando(), true);
});

test('aplicar() sin waitingWorker hace reload directo de la ventana', async () => {
  let reloadLlamado = false;
  const mockSw = crearMockServiceWorker();
  const mockWindow = {
    location: {
      reload() { reloadLlamado = true; },
    },
  };

  const ctrl = crearControladorActualizacion({
    serviceWorker: mockSw,
    windowObj: mockWindow,
  });

  ctrl.aplicar();
  assert.equal(reloadLlamado, true);
  assert.equal(ctrl.isRecargando(), true);
});

test('visibilitychange y online disparan chequeo de actualización', async () => {
  const mockSw = crearMockServiceWorker();
  const mockReg = crearMockRegistration();
  mockSw.mockRegistration = mockReg;

  const docListeners = {};
  const mockDoc = {
    visibilityState: 'visible',
    addEventListener(evt, fn) {
      docListeners[evt] = docListeners[evt] || [];
      docListeners[evt].push(fn);
    },
  };

  const winListeners = {};
  const mockWin = {
    addEventListener(evt, fn) {
      winListeners[evt] = winListeners[evt] || [];
      winListeners[evt].push(fn);
    },
  };

  const ctrl = crearControladorActualizacion({
    serviceWorker: mockSw,
    documentObj: mockDoc,
    windowObj: mockWin,
  });

  await ctrl.iniciar();

  assert.equal(mockReg.updateCalled(), false);

  // Al pasar a visible dispara chequeo
  (docListeners['visibilitychange'] || []).forEach((fn) => fn());
  assert.equal(mockReg.updateCalled(), true);

  // Al reconectar online dispara chequeo
  let segundoChequeoLlamado = false;
  mockReg.update = async () => { segundoChequeoLlamado = true; };
  (winListeners['online'] || []).forEach((fn) => fn());
  assert.equal(segundoChequeoLlamado, true);
});

