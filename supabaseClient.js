import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = '___';
const SUPABASE_ANON_KEY = '___';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

export async function signInWithOtp(email) {
  return supabase.auth.signInWithOtp({ email });
}

export async function signOut() {
  return supabase.auth.signOut();
}

export async function getSession() {
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  return data.session;
}
