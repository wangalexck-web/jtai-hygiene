function json(res, status, obj) {
  res.status(status).setHeader("content-type", "application/json; charset=utf-8");
  res.end(JSON.stringify(obj));
}

function bearer(req) {
  const h = req.headers["authorization"] || "";
  if (typeof h === "string" && h.toLowerCase().startsWith("bearer ")) return h.slice(7).trim();
  return "";
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
    if (req.method !== "POST") return json(res, 405, { ok: false, error: "METHOD_NOT_ALLOWED" });

    const token = bearer(req);
    if (!process.env.ADMIN_TOKEN || token !== process.env.ADMIN_TOKEN) {
      return json(res, 401, { ok: false, error: "UNAUTHORIZED" });
    }

    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
    const org_name = (body.org_name || "").trim();
    const org_code = (body.org_code || "").trim().toLowerCase();

    if (!org_name || !org_code) {
      return json(res, 400, { ok: false, error: "BAD_REQUEST", message: "org_name, org_code required" });
    }

    // ✅ 先只做 org 建立：這一步一定能跑通（因為你已經有 orgs 表）
    const orgR = await sbInsert("orgs", [{ name: org_name, code: org_code, is_active: true }]);
    if (!orgR.ok) return json(res, 502, { ok: false, error: "SUPABASE_ERROR_ORG", detail: orgR });

    const org = Array.isArray(orgR.data) ? orgR.data[0] : orgR.data;
    return json(res, 200, { ok: true, org });
  } catch (e) {
    return json(res, 500, { ok: false, error: "SERVER_ERROR", message: String(e?.message || e) });
  }
}
