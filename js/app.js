import { initAuth } from './auth.js';

function onSignedIn(session) {
  console.log('Sesión iniciada:', session.user.email);
}

initAuth(onSignedIn);
