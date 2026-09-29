const SESSION_STORAGE_KEY = "dashboard-session";
const LOCAL_BACKEND_ORIGIN =
  /^(localhost|127\.0\.0\.1)$/i.test(window.location.hostname) && window.location.port !== "5000"
    ? "http://localhost:5000"
    : "";

async function request(url, options = {}) {
  const session = getSession();
  const headers = { "Content-Type": "application/json", ...options.headers };

  if (session?.access_token) {
    headers.Authorization = `Bearer ${session.access_token}`;
  }

  let response;
  try {
    response = await fetch(`${LOCAL_BACKEND_ORIGIN}${url}`, { ...options, headers });
  } catch {
    return {
      data: null,
      error: { message: "Cannot reach the backend. Start the server and try again." },
    };
  }

  let payload = {};
  const contentType = response.headers.get("content-type") || "unknown content type";
  try {
    const body = response.status === 204 ? "" : await response.text();
    payload = body ? JSON.parse(body) : {};
  } catch {
    return {
      data: null,
      error: { message: `Backend response could not be read (HTTP ${response.status}; ${contentType}).` },
    };
  }

  if (!response.ok) {
    return {
      data: null,
      error: { message: payload.error || `Backend request failed (HTTP ${response.status}).` },
    };
  }

  return { data: payload.data ?? null, error: null };
}

function getSession() {
  try {
    return JSON.parse(localStorage.getItem(SESSION_STORAGE_KEY));
  } catch {
    return null;
  }
}

function storeSession(session) {
  if (session) {
    localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(session));
  }
}

function recoveryToken() {
  return new URLSearchParams(window.location.hash.slice(1)).get("access_token");
}

export async function signUp({ email, password, fullName }) {
  const result = await request("/api/auth/signup", {
    method: "POST",
    body: JSON.stringify({ email, password, fullName }),
  });

  storeSession(result.data?.session);
  return result;
}

export async function signInWithPassword({ email, password }) {
  const result = await request("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });

  storeSession(result.data?.session);
  return result;
}

export async function signInWithOAuth(provider) {
  return request(`/api/auth/oauth/${encodeURIComponent(provider)}`, { method: "POST" });
}

export async function signInWithGoogle() {
  return signInWithOAuth("google");
}

export function getOAuthSessionFromHash() {
  const hashParams = new URLSearchParams(window.location.hash.slice(1));
  const queryParams = new URLSearchParams(window.location.search);
  const accessToken = hashParams.get("access_token");

  if (!accessToken) {
    const errorMsg =
      hashParams.get("error_description") ||
      queryParams.get("error_description") ||
      hashParams.get("error") ||
      queryParams.get("error");
    return { session: null, error: errorMsg || null };
  }

  const session = {
    access_token: accessToken,
    refresh_token: hashParams.get("refresh_token"),
    token_type: hashParams.get("token_type"),
  };
  storeSession(session);
  window.history.replaceState({}, document.title, window.location.pathname);
  return { session, error: null };
}

export function signOut() {
  localStorage.removeItem(SESSION_STORAGE_KEY);
  return Promise.resolve({ error: null });
}

export function getUser() {
  return request("/api/auth/me");
}

export function resetPasswordForEmail(email) {
  return request("/api/auth/reset-password", {
    method: "POST",
    body: JSON.stringify({ email }),
  });
}

export function updateUser({ password }) {
  const token = recoveryToken() || getSession()?.access_token;

  if (!token) {
    return Promise.resolve({
      data: null,
      error: { message: "Your password-reset link is invalid or has expired." },
    });
  }

  return request("/api/auth/update-password", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify({ password }),
  });
}

export function updateProfile({ fullName }) {
  return request("/api/auth/update-profile", {
    method: "POST",
    body: JSON.stringify({ fullName }),
  });
}

export function getCompanies(limit = 25, offset = 0) {
  return request(`/api/companies?limit=${limit}&offset=${offset}`);
}

export function searchCompanies(query) {
  return request(`/api/companies/search?query=${encodeURIComponent(query)}`);
}

export function addCompany(company) {
  return request("/api/companies", {
    method: "POST",
    body: JSON.stringify(company),
  });
}

export function getCompanyDetails(id) {
  return request(`/api/companies/${encodeURIComponent(id)}`);
}

export function getCompanyProfile(googleMapsLink) {
  return request(`/api/company-profile?google_maps_link=${encodeURIComponent(googleMapsLink)}`);
}

export function addCompanyEmployee(companyId, employee) {
  return request(`/api/companies/${encodeURIComponent(companyId)}/employees`, {
    method: "POST",
    body: JSON.stringify(employee),
  });
}

export function startMapsScrape(search) {
  return request("/api/scrapes", {
    method: "POST",
    body: JSON.stringify(search),
  });
}

export function getMapsScrape(jobId, since = 0) {
  const query = typeof since === "number" || typeof since === "string" ? `?since=${since}` : "";
  return request(`/api/scrapes/${encodeURIComponent(jobId)}${query}`);
}

export function submitFeedback({ type, message }) {
  return request("/api/feedback", {
    method: "POST",
    body: JSON.stringify({ type, message }),
  });
}

export function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function link(value, label) {
  return value
    ? `<a href="${escapeHtml(value)}" target="_blank" rel="noopener noreferrer">${label}</a>`
    : "—";
}

export function getInitials(name) {
  return String(name || "?")
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
}

export function extractPlaceId(url) {
  if (!url) return "";
  const m1 = String(url).match(/1s(0x[0-9a-fA-F]+:0x[0-9a-fA-F]+)/);
  if (m1) return m1[1].toLowerCase();
  const m2 = String(url).match(/(ChIJ[a-zA-Z0-9_-]+)/);
  if (m2) return m2[1];
  return "";
}

export function cleanMapsLink(url) {
  return String(url || "").split("?")[0].replace(/\/+$/, "").toLowerCase();
}

export function normalizeCompanyName(name) {
  return String(name || "")
    .toLowerCase()
    .replace(/\b(pvt|ltd|llc|inc|private|limited|corp|corporation|co)\b/gi, "")
    .replace(/[^a-z0-9]/g, "")
    .trim();
}

export function normalizeAddress(addr) {
  return String(addr || "").toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 30);
}

export function deduplicateCompanies(rows) {
  const seen = new Set();
  return rows.filter((company) => {
    const cid = extractPlaceId(company.google_maps_link);
    const cleanLink = cleanMapsLink(company.google_maps_link);
    const normName = normalizeCompanyName(company.company_name);
    const normAddr = normalizeAddress(company.address);

    if (cid && seen.has(`cid:${cid}`)) return false;
    if (cleanLink && seen.has(`link:${cleanLink}`)) return false;
    if (normName && normAddr && seen.has(`na:${normName}::${normAddr}`)) return false;

    if (cid) seen.add(`cid:${cid}`);
    if (cleanLink) seen.add(`link:${cleanLink}`);
    if (normName && normAddr) seen.add(`na:${normName}::${normAddr}`);
    return true;
  });
}

export function setupSocialAuth(statusElement) {
  document.querySelectorAll("[data-provider]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const provider = btn.dataset.provider;
      if (provider === "instagram") {
        if (statusElement) statusElement.textContent = "Instagram sign-in needs a separate Meta OAuth setup.";
        return;
      }
      if (statusElement) {
        statusElement.textContent = "";
        statusElement.className = "message";
      }
      btn.disabled = true;
      btn.setAttribute("aria-busy", "true");
      const { data, error } = await signInWithOAuth(provider);
      if (error) {
        if (statusElement) statusElement.textContent = error.message;
        btn.disabled = false;
        btn.removeAttribute("aria-busy");
        return;
      }
      window.location.assign(data.url);
    });
  });
}

