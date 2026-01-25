import bcrypt from "bcryptjs";

function json(res, status, obj) {
  res.statusCode = status;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.end(JSON.stringify(obj));
}

function getBearerToken(req) {
  const h = req.headers["authorization"] || req.headers["Authorization"] || "";
  if (typeof h !== "string") return "";
  const m = h.match(/^\s*bearer\s+(.+)\s*$/i);
  return m ? m[1].trim() : "";
}

function mustEnv(name) {
  const v = (process.env[name] || "").trim();
  if (!v) throw new Error(`MISSING_ENV:${name}`);
  return v;
}

async function sbGet(path) {
  const SUPABASE_URL = mustEnv("SUPABASE_URL");
  const SERVICE_ROLE = mustEnv("SUPABASE_SERVICE_ROLE_KEY");

  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method: "GET",
    headers: {
      "apikey": SERVICE_ROLE,
      "authorization": `Bearer ${SERVICE_ROLE}`
    }
  });

  const text = await r.text();
  let data;
  try { data = JSON.parse(text); } catch { data = text; }
  return { ok: r.ok, status: r.status, data };
}

async function sbPatch(table, filterQuery, patchObj) {
  const SUPABASE_URL = mustEnv("SUPABASE_URL");
  const SERVICE_ROLE = mustEnv("SUPABASE_SERVICE_ROLE_KEY");

  const r = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${filterQuery}`, {
    method: "PATCH",
    headers: {
      "content-type": "application/json",
      "apikey": SERVICE_ROLE,
      "authorization": `Bearer ${SERVICE_ROLE}`,
      "prefer": "return=representation"
    },
    body: JSON.stringify(patchObj)
  });

  const text = await r.text();
  let data;
  try { data = JSON.parse(text); } catch { data = text; }
  return { ok: r.ok, status: r.status, data };
}

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") return json(res, 405, { ok: false, error: "METHOD_NOT_ALLOWED" });

    const adminToken = (process.env.ADMIN_TOKEN || "").trim();
    if (!adminToken) return json(res, 500, { ok: false, error: "ADMIN_TOKEN_NOT_SET" });

    const bearer = getBearerToken(req);
    if (!bearer) return json(res, 401, { ok: false, error: "MISSING_BEARER" });
    if (bearer !== adminToken) return json(res, 401, { ok: false, error: "UNAUTHORIZED" });

    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
    const username = (body.username || "").trim().toLowerCase();
    const new_password = (body.new_password || "").trim();

    if (!username || !new_password || new_password.length < 6) {
      return json(res, 400, { ok: false, error: "BAD_REQUEST", message: "username + new_password (>=6) required" });
    }

    const uR = await sbGet(`users?username=eq.${encodeURIComponent(username)}&select=id,username,is_active`);
    if (!uR.ok) return json(res, 502, { ok: false, error: "SUPABASE_ERROR_USER_LOOKUP", detail: uR });

    const user = Array.isArray(uR.data) ? uR.data[0] : null;
    if (!user) return json(res, 404, { ok: false, error: "USER_NOT_FOUND" });

    const hash = await bcrypt.hash(new_password, 10);

    const pR = await sbPatch("users", `id=eq.${encodeURIComponent(user.id)}`, { password_hash: hash });
    if (!pR.ok) return json(res, 502, { ok: false, error: "SUPABASE_ERROR_USER_PATCH", detail: pR });

    return json(res, 200, { ok: true, user: pR.data?.[0] || pR.data });
  } catch (e) {
    return json(res, 500, { ok: false, error: "SERVER_ERROR", message: String(e?.message || e) });
  }
}
