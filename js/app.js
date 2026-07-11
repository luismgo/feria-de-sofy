import { initAuth } from './auth.js';
import { initFeriaSelector } from './ferias.js';

function showFeriaSelector() {
  initFeriaSelector((feria) => {
    console.log('Feria elegida:', feria.nombre);
  });
}

initAuth(showFeriaSelector);
