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

async function sbPost(table, rows) {
  const SUPABASE_URL = mustEnv("SUPABASE_URL");
  const SERVICE_ROLE = mustEnv("SUPABASE_SERVICE_ROLE_KEY");

  const r = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "apikey": SERVICE_ROLE,
      "authorization": `Bearer ${SERVICE_ROLE}`,
      "prefer": "return=representation"
    },
    body: JSON.stringify(rows)
  });

  const text = await r.text();
  let data;
  try { data = JSON.parse(text); } catch { data = text; }
  return { ok: r.ok, status: r.status, data };
}

function simpleTempHash() {
  return `temp$${Date.now()}$${Math.random().toString(16).slice(2)}`;
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
    const org_id = (body.org_id || "").trim();                 // ✅ 改用 org_id
    const username = (body.username || "").trim().toLowerCase();
    const display_name = (body.display_name || "").trim() || null;

    if (!org_id || !username) {
      return json(res, 400, { ok: false, error: "BAD_REQUEST", message: "org_id, username required" });
    }

    // 1) 確認 org 存在（用 id）
    const orgR = await sbGet(`orgs?id=eq.${encodeURIComponent(org_id)}&select=*`);
    if (!orgR.ok) return json(res, 502, { ok: false, error: "SUPABASE_ERROR_ORG_LOOKUP", detail: orgR });

    const org = Array.isArray(orgR.data) ? orgR.data[0] : null;
    if (!org) return json(res, 404, { ok: false, error: "ORG_NOT_FOUND", org_id });

    // 2) 找 user（不存在就建立）
    const userFindR = await sbGet(`users?username=eq.${encodeURIComponent(username)}&select=*`);
    if (!userFindR.ok) return json(res, 502, { ok: false, error: "SUPABASE_ERROR_USER_LOOKUP", detail: userFindR });

    let user = Array.isArray(userFindR.data) ? userFindR.data[0] : null;

    if (!user) {
      const userInsR = await sbPost("users", [{
        username,
        password_hash: simpleTempHash(),
        display_name
      }]);
      if (!userInsR.ok) return json(res, 502, { ok: false, error: "SUPABASE_ERROR_USER_CREATE", detail: userInsR });
      user = Array.isArray(userInsR.data) ? userInsR.data[0] : userInsR.data;
    }

    // 3) member 既有就不重複建
    const memFindR = await sbGet(`org_members?org_id=eq.${encodeURIComponent(org.id)}&user_id=eq.${encodeURIComponent(user.id)}&select=*`);
    if (!memFindR.ok) return json(res, 502, { ok: false, error: "SUPABASE_ERROR_MEMBER_LOOKUP", detail: memFindR });

    let member = Array.isArray(memFindR.data) ? memFindR.data[0] : null;

    if (!member) {
      const memInsR = await sbPost("org_members", [{
        org_id: org.id,
        user_id: user.id,
        role: "owner"
      }]);
      if (!memInsR.ok) return json(res, 502, { ok: false, error: "SUPABASE_ERROR_MEMBER_CREATE", detail: memInsR, org, user });
      member = Array.isArray(memInsR.data) ? memInsR.data[0] : memInsR.data;
    }

    return json(res, 200, { ok: true, org, owner: user, member });
  } catch (e) {
    return json(res, 500, { ok: false, error: "SERVER_ERROR", message: String(e?.message || e) });
  }
}

