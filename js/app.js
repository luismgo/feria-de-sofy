import { supabase } from './supabaseClient.js';

async function checkConnection() {
  const { count, error } = await supabase.from('ferias').select('*', { count: 'exact', head: true });
  if (error) {
    console.error('Error conectando a Supabase:', error.message);
  } else {
    console.log(`Conectado a Supabase. Ferias en la base: ${count}`);
  }
}

checkConnection();
