import { BACKEND_URL } from "./backend-config.js";

const TOKEN_KEY = "lp_token";
const EMAIL_KEY = "lp_email";

export function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}

export function getStoredEmail() {
  return localStorage.getItem(EMAIL_KEY);
}

export function setSession(token, email) {
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(EMAIL_KEY, email);
}

export function clearSession() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(EMAIL_KEY);
}

export async function call(action, params) {
  const res = await fetch(BACKEND_URL, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify({ action, params, token: getToken() }),
  });
  if (!res.ok) throw new Error(`Backend request failed (${res.status})`);
  const json = await res.json();
  if (json != null && typeof json === "object" && !Array.isArray(json) && "error" in json) {
    throw new Error(json.error);
  }
  return json;
}
