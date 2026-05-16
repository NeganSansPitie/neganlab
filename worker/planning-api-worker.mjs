const KV_KEY = "planning_entries_v1";
const SESSION_COOKIE = "__Host-neganlab-admin";
const API_ORIGINS = [
  "https://www.neganlab.be",
  "https://neganlab.be",
  "http://127.0.0.1:5500",
  "http://localhost:5500"
];

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const method = request.method.toUpperCase();

    if (method === "OPTIONS") {
      return cors(new Response(null, { status: 204 }), request);
    }

    try {
      if (url.pathname === "/api/planning" && method === "GET") {
        return cors(jsonResponse({ entries: await readEntries(env) }), request);
      }

      if (url.pathname === "/api/admin/login" && method === "POST") {
        return await login(request, env);
      }

      if (url.pathname === "/api/admin/logout" && method === "POST") {
        return cors(logout(), request);
      }

      if (url.pathname === "/api/admin/planning") {
        const admin = await requireAdmin(request, env);
        if (!admin.authorized) {
          return cors(jsonResponse({ error: "Non autorisé." }, admin.status), request);
        }

        if (method === "GET") {
          return cors(jsonResponse({ entries: await readEntries(env) }), request);
        }

        if (method === "POST") {
          const payload = await request.json();
          const entry = normalizeEntry(payload, true);
          const entries = await readEntries(env);
          entries.push(entry);
          await writeEntries(env, entries);
          return cors(jsonResponse({ entry, entries: sortEntries(entries) }, 201), request);
        }

        if (method === "PUT") {
          const payload = await request.json();
          const entry = normalizeEntry(payload, false);
          const entries = await readEntries(env);
          const index = entries.findIndex((item) => item.id === entry.id);
          if (index === -1) {
            return cors(jsonResponse({ error: "Événement introuvable." }, 404), request);
          }
          entries[index] = entry;
          await writeEntries(env, entries);
          return cors(jsonResponse({ entry, entries: sortEntries(entries) }), request);
        }

        if (method === "DELETE") {
          const all = url.searchParams.get("all");
          if (all === "1") {
            await writeEntries(env, []);
            return cors(jsonResponse({ entries: [] }), request);
          }

          const id = url.searchParams.get("id");
          if (!id) {
            return cors(jsonResponse({ error: "Identifiant manquant." }, 400), request);
          }

          const entries = await readEntries(env);
          const nextEntries = entries.filter((item) => item.id !== id);
          await writeEntries(env, nextEntries);
          return cors(jsonResponse({ entries: sortEntries(nextEntries) }), request);
        }
      }

      return cors(jsonResponse({ error: "Not found." }, 404), request);
    } catch (error) {
      return cors(jsonResponse({ error: error instanceof Error ? error.message : "Erreur interne." }, 500), request);
    }
  }
};

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store"
    }
  });
}

function cors(response, request) {
  const origin = request.headers.get("Origin");
  if (origin && API_ORIGINS.includes(origin)) {
    response.headers.set("Access-Control-Allow-Origin", origin);
    response.headers.set("Access-Control-Allow-Credentials", "true");
    response.headers.set("Vary", "Origin");
  }
  response.headers.set("Access-Control-Allow-Headers", "Content-Type");
  response.headers.set("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE,OPTIONS");
  return response;
}

async function login(request, env) {
  const { email = "", password = "" } = await request.json();

  if (!env.ADMIN_EMAIL || !env.ADMIN_PASSWORD || !env.SESSION_SECRET) {
    return cors(jsonResponse({ error: "Configuration Cloudflare incomplète." }, 500), request);
  }

  if (email.trim().toLowerCase() !== String(env.ADMIN_EMAIL).trim().toLowerCase() || password !== env.ADMIN_PASSWORD) {
    return cors(jsonResponse({ error: "Identifiants invalides." }, 401), request);
  }

  const expiresAt = Date.now() + (7 * 24 * 60 * 60 * 1000);
  const token = await signSession({ email: env.ADMIN_EMAIL, expiresAt }, env.SESSION_SECRET);
  const response = jsonResponse({ ok: true });
  response.headers.append(
    "Set-Cookie",
    `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=None; Max-Age=604800`
  );
  return cors(response, request);
}

function logout() {
  const response = jsonResponse({ ok: true });
  response.headers.append(
    "Set-Cookie",
    `${SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=None; Max-Age=0`
  );
  return response;
}

async function requireAdmin(request, env) {
  if (!env.ADMIN_EMAIL || !env.SESSION_SECRET) {
    return { authorized: false, status: 500 };
  }

  const cookies = parseCookies(request.headers.get("Cookie") || "");
  const token = cookies[SESSION_COOKIE];
  if (!token) {
    return { authorized: false, status: 401 };
  }

  const session = await verifySession(token, env.SESSION_SECRET);
  if (!session) {
    return { authorized: false, status: 401 };
  }

  if (session.expiresAt < Date.now()) {
    return { authorized: false, status: 401 };
  }

  if (String(session.email).trim().toLowerCase() !== String(env.ADMIN_EMAIL).trim().toLowerCase()) {
    return { authorized: false, status: 403 };
  }

  return { authorized: true, email: session.email };
}

function parseCookies(header) {
  return header.split(";").reduce((acc, part) => {
    const [key, ...rest] = part.trim().split("=");
    if (!key) return acc;
    acc[key] = rest.join("=");
    return acc;
  }, {});
}

async function signSession(payload, secret) {
  const encoder = new TextEncoder();
  const body = btoa(JSON.stringify(payload));
  const data = encoder.encode(body);
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", key, data);
  const signatureBase64 = toBase64Url(signature);
  return `${body}.${signatureBase64}`;
}

async function verifySession(token, secret) {
  const [body, signature] = token.split(".");
  if (!body || !signature) return null;

  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"]
  );

  const verified = await crypto.subtle.verify(
    "HMAC",
    key,
    fromBase64Url(signature),
    encoder.encode(body)
  );

  if (!verified) return null;

  try {
    return JSON.parse(atob(body));
  } catch {
    return null;
  }
}

function toBase64Url(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function fromBase64Url(value) {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((value.length + 3) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function readEntries(env) {
  const raw = await env.PLANNING_KV.get(KV_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? sortEntries(parsed) : [];
  } catch {
    return [];
  }
}

async function writeEntries(env, entries) {
  await env.PLANNING_KV.put(KV_KEY, JSON.stringify(sortEntries(entries)));
}

function sortEntries(entries) {
  return [...entries].sort((a, b) => String(a.startDate).localeCompare(String(b.startDate)));
}

function normalizeEntry(payload, create) {
  const title = String(payload?.title || "").trim();
  const description = String(payload?.description || "").trim();
  const startDate = String(payload?.startDate || "").trim();
  const endDate = String(payload?.endDate || "").trim();
  const orientation = payload?.orientation === "vertical" ? "vertical" : "horizontal";
  const image = String(payload?.image || "").trim();
  const platforms = Array.isArray(payload?.platforms)
    ? payload.platforms.filter((value) => value === "youtube" || value === "twitch")
    : [];

  if (!title) throw new Error("Le titre est obligatoire.");
  if (!startDate) throw new Error("La date de début est obligatoire.");
  if (!image) throw new Error("L'image est obligatoire.");
  if (!platforms.length) throw new Error("Choisis au moins une plateforme.");

  return {
    id: create ? crypto.randomUUID() : String(payload?.id || "").trim(),
    title,
    description,
    startDate,
    endDate,
    orientation,
    image,
    platforms
  };
}
