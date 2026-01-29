function json(res, status, obj) {
  res.statusCode = status;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.end(JSON.stringify(obj));
}

// 更健壯的 Bearer 解析（容忍大小寫與多餘空白）
function getBearerToken(req) {
  const h = req.headers["authorization"] || req.headers["Authorization"] || "";
  if (typeof h !== "string") return "";
  const m = h.match(/^\s*bearer\s+(.+)\s*$/i);
  return m ? m[1].trim() : "";
}

async function sbInsert(table, rows) {
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY;

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

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      return json(res, 405, { ok: false, error: "METHOD_NOT_ALLOWED" });
    }

    const adminToken = (process.env.ADMIN_TOKEN || "").trim();
    const bearer = getBearerToken(req);

    // 清楚回錯（方便你定位）
    if (!adminToken) {
      return json(res, 500, { ok: false, error: "ADMIN_TOKEN_NOT_SET" });
    }
    if (!bearer) {
      return json(res, 401, { ok: false, error: "MISSING_BEARER" });
    }
    if (bearer !== adminToken) {
      return json(res, 401, { ok: false, error: "UNAUTHORIZED" });
    }

    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
    const org_name = (body.org_name || "").trim();
    const org_code = (body.org_code || "").trim().toLowerCase();

    if (!org_name || !org_code) {
      return json(res, 400, { ok: false, error: "BAD_REQUEST", message: "org_name, org_code required" });
    }

    const orgR = await sbInsert("orgs", [{ name: org_name, code: org_code, is_active: true }]);
    if (!orgR.ok) {
      return json(res, 502, { ok: false, error: "SUPABASE_ERROR_ORG", detail: orgR });
    }

    const org = Array.isArray(orgR.data) ? orgR.data[0] : orgR.data;
    return json(res, 200, { ok: true, org });
  } catch (e) {
    return json(res, 500, { ok: false, error: "SERVER_ERROR", message: String(e?.message || e) });
  }
}

