// =====================================================================
// api.js — client leggero per le API REST del backend PHP
// =====================================================================
import { API_BASE } from './config.js';

const TOKEN_KEY = 'nh_token';
const USER_KEY = 'nh_user';

export function getToken() { return localStorage.getItem(TOKEN_KEY); }
export function getStoredUser() {
  try { return JSON.parse(localStorage.getItem(USER_KEY) || 'null'); }
  catch { return null; }
}
export function setSession(token, user) {
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(USER_KEY, JSON.stringify(user));
}
export function clearSession() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
}
export function isLoggedIn() { return !!getToken(); }
// v1.35.0 — isLoggedIn() sopra è vero anche per un ospite anonimo (ha
// comunque un token di sessione valido, solo silenzioso): per capire
// se qualcuno è REALMENTE registrato con email (non solo "ha una
// sessione qualunque") serve questo controllo dedicato, usato per
// esempio per disabilitare il riscatto di missioni/traguardi a chi
// gioca ancora da ospite.
export function isRegistered() {
  const user = getStoredUser();
  return !!(user && !user.is_guest);
}

async function request(path, { method = 'GET', body = null, auth = true } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  const token = getToken();
  if (auth && token) {
    // Header custom primario: molti host condivisi (Apache+PHP-FPM/CGI)
    // eliminano "Authorization" prima che arrivi a PHP, mentre gli
    // header custom come questo passano sempre. Manteniamo comunque
    // anche "Authorization" per compatibilità con altri setup.
    headers['X-Auth-Token'] = token;
    headers['Authorization'] = `Bearer ${token}`;
  }

  let res;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : null,
    });
  } catch (networkErr) {
    return { ok: false, error: 'Rete non disponibile', offline: true };
  }

  let data;
  try { data = await res.json(); }
  catch { data = { ok: false, error: 'Risposta non valida dal server' }; }

  if (res.status === 401) clearSession();

  return data;
}

export const Api = {
  registerGuest: (nickname) => request('/auth/register.php', { method: 'POST', body: { mode: 'guest', nickname }, auth: false }),
  register: (email, password, nickname) => request('/auth/register.php', { method: 'POST', body: { mode: 'account', email, password, nickname }, auth: false }),
  login: (email, password) => request('/auth/login.php', { method: 'POST', body: { email, password }, auth: false }),
  forgotPassword: (email) => request('/auth/forgot.php', { method: 'POST', body: { email }, auth: false }),
  resetPassword: (email, code, newPassword) => request('/auth/reset.php', { method: 'POST', body: { email, code, new_password: newPassword }, auth: false }),
  setNickname: (nickname) => request('/auth/set_nickname.php', { method: 'POST', body: { nickname } }),
  deleteAccount: (password) => request('/account/delete.php', { method: 'POST', body: { password } }),

  runStart: () => request('/run/start.php', { method: 'POST' }),
  runSubmit: (payload) => request('/run/submit.php', { method: 'POST', body: payload }),
  feedback: (payload) => request('/feedback.php', { method: 'POST', body: payload }),
  heartbeat: () => request('/heartbeat.php', { method: 'POST' }),
  onlineCount: () => request('/online_count.php'),

  leaderboard: () => request('/leaderboard.php', { auth: true }),

  shopList: () => request('/shop.php', { auth: true }),
  shopBuy: (itemId) => request('/shop/buy.php', { method: 'POST', body: { item_id: itemId } }),

  missionsList: () => request('/missions.php'),
  missionsClaim: (missionId) => request('/missions/claim.php', { method: 'POST', body: { mission_id: missionId } }),
  achievementsList: () => request('/achievements.php'),
  achievementsClaim: (tierId) => request('/achievements/claim.php', { method: 'POST', body: { tier_id: tierId } }),
};
