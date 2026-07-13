import { supabase } from './supabaseClient.js';

export function initAuth(onSignedIn) {
  const screen = document.getElementById('login-gate');
  const form = document.getElementById('login-form');
  const input = document.getElementById('login-email');
  const message = document.getElementById('login-message');
  const submitBtn = form.querySelector('button');

  // Entrar a la app una sola vez por sesión: onAuthStateChange también dispara en
  // TOKEN_REFRESHED / USER_UPDATED, y re-ejecutar onSignedIn ahí sacaría a Sofy al
  // selector de feria y le vaciaría el carrito a mitad de venta.
  let entered = false;
  supabase.auth.onAuthStateChange((_event, session) => {
    if (session && !entered) {
      entered = true;
      screen.classList.add('hidden');
      onSignedIn(session);
    } else if (!session) {
      entered = false;
      screen.classList.remove('hidden');
    }
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    message.classList.add('hidden');
    submitBtn.disabled = true;
    submitBtn.textContent = 'Enviando...';

    const { error } = await supabase.auth.signInWithOtp({
      email: input.value.trim(),
      options: {
        shouldCreateUser: false,
        emailRedirectTo: window.location.origin + window.location.pathname,
      },
    });

    submitBtn.disabled = false;
    submitBtn.textContent = 'Enviar link';
    message.classList.remove('hidden');

    if (error) {
      message.textContent = `No pudimos enviarte el link: ${error.message}`;
      message.classList.add('error');
    } else {
      message.textContent = 'Revisá tu correo 💌 — te mandamos un link para entrar';
      message.classList.remove('error');
    }
  });
}
