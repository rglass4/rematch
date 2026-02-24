import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = 'https://uqwkndfkjeysilsbggpf.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_wUK7P00_jrX7hktpHIVbJw_ayWLYN9p';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

function getEmailRedirectUrl() {
  return new URL('./index.html', window.location.href).toString();
}

export async function signInWithPassword(email, password) {
  return supabase.auth.signInWithPassword({
    email,
    password
  });
}

export async function signUpWithPassword(email, password) {
  return supabase.auth.signUp({
    email,
    password,
    options: {
      emailRedirectTo: getEmailRedirectUrl()
    }
  });
}

export async function signOut() {
  return supabase.auth.signOut();
}

export async function getSession() {
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  return data.session;
}
