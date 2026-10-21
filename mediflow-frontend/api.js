// api.js
// Shared helper for talking to the MediFlow backend.
// Handles the auth token and redirects to login if the session is missing/expired.

const API_BASE = "https://mediflow-1-6zql.onrender.com/api";

function getToken() {
  return localStorage.getItem("mediflow_token");
}

function getClinic() {
  const raw = localStorage.getItem("mediflow_clinic");
  return raw ? JSON.parse(raw) : null;
}

function saveSession(token, clinic) {
  localStorage.setItem("mediflow_token", token);
  localStorage.setItem("mediflow_clinic", JSON.stringify(clinic));
}

function clearSession() {
  localStorage.removeItem("mediflow_token");
  localStorage.removeItem("mediflow_clinic");
}

function requireSession() {
  if (!getToken()) {
    window.location.href = "index.html";
  }
}

async function apiFetch(path, options = {}) {
  const token = getToken();
  const headers = Object.assign(
    { "Content-Type": "application/json" },
    options.headers || {},
    token ? { Authorization: "Bearer " + token } : {},
  );

  const response = await fetch(API_BASE + path, { ...options, headers });

  if (response.status === 401) {
    clearSession();
    window.location.href = "index.html";
    throw new Error("Session expired");
  }

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(data.error || "Request failed");
  }

  return data;
}
