import bcrypt from "bcryptjs";

function json(res, status, obj) {
  res.statusCode = status;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.end(JSON.stringify(obj));
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

    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
    const username = (body.username || "").trim().toLowerCase();
    const password = (body.password || "").trim();

    if (!username || !password) {
      return json(res, 400, { ok: false, error: "BAD_REQUEST", message: "username + password required" });
    }

    const uR = await sbGet(`users?username=eq.${encodeURIComponent(username)}&select=*`);
    if (!uR.ok) return json(res, 502, { ok: false, error: "SUPABASE_ERROR_USER_LOOKUP", detail: uR });

    const user = Array.isArray(uR.data) ? uR.data[0] : null;
    if (!user) return json(res, 401, { ok: false, error: "INVALID_CREDENTIALS" });
    if (user.is_active === false) return json(res, 403, { ok: false, error: "USER_DISABLED" });

    const ok = await bcrypt.compare(password, user.password_hash || "");
    if (!ok) return json(res, 401, { ok: false, error: "INVALID_CREDENTIALS" });

    // 查他有哪些 org + role
    const mR = await sbGet(`org_members?user_id=eq.${encodeURIComponent(user.id)}&select=org_id,role,status,orgs(id,name,is_active)`);
    if (!mR.ok) return json(res, 502, { ok: false, error: "SUPABASE_ERROR_MEMBERS", detail: mR });

    // 更新 last_login_at
    await sbPatch("users", `id=eq.${encodeURIComponent(user.id)}`, { last_login_at: new Date().toISOString() });

    // 回傳（先不發 JWT，Pilot 先用 session-less）
    return json(res, 200, {
      ok: true,
      user: {
        id: user.id,
        username: user.username,
        display_name: user.display_name,
        is_active: user.is_active
      },
      memberships: mR.data
    });
  } catch (e) {
    return json(res, 500, { ok: false, error: "SERVER_ERROR", message: String(e?.message || e) });
  }
}
