import { call, setSession, clearSession, getStoredEmail, getToken } from "./backend.js";

let listeners = [];
let currentUser = null;

export async function login(email, password) {
  const res = await call("login", { email, password });
  setSession(res.token, res.email);
  currentUser = { email: res.email };
  notify_();
}

export async function createAccount(email, password) {
  return call("createUser", { email, password });
}

export async function logout() {
  try { await call("logout", {}); } catch (err) { /* session may already be gone server-side */ }
  clearSession();
  currentUser = null;
  notify_();
}

export function watchAuth(callback) {
  listeners.push(callback);
  const token = getToken();
  const email = getStoredEmail();
  currentUser = token && email ? { email } : null;
  callback(currentUser);
  return () => { listeners = listeners.filter((l) => l !== callback); };
}

function notify_() {
  listeners.forEach((l) => l(currentUser));
}
