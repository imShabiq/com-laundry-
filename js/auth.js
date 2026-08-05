import { supabase } from "./supabase-init.js";

export async function login(email, password) {
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
}

export async function logout() {
  await supabase.auth.signOut();
}

export function watchAuth(callback) {
  supabase.auth.getSession().then(({ data }) => callback(data.session?.user ?? null));
  const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
    callback(session?.user ?? null);
  });
  return () => sub.subscription.unsubscribe();
}
