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

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      return json(res, 405, { ok:false, error:"METHOD_NOT_ALLOWED" });
    }

    const adminToken = (process.env.ADMIN_TOKEN || "").trim();
    if (!adminToken) return json(res, 500, { ok:false, error:"ADMIN_TOKEN_NOT_SET" });

    const bearer = getBearerToken(req);
    if (!bearer) return json(res, 401, { ok:false, error:"MISSING_BEARER" });
    if (bearer !== adminToken) return json(res, 401, { ok:false, error:"UNAUTHORIZED" });

    const body = typeof req.body === "string"
      ? JSON.parse(req.body || "{}")
      : (req.body || {});

    const org_id = (body.org_id || "").trim();
    const name = (body.name || "").trim();
    const description = (body.description || "").trim();
    const is_active = body.is_active === false ? false : true;

    if (!org_id || !name) {
      return json(res, 400, {
        ok:false,
        error:"BAD_REQUEST",
        message:"org_id + name required"
      });
    }

    const r = await sbPost("checklists", [{
      org_id,
      name,
      description: description || null,
      is_active
    }]);

    if (!r.ok) {
      return json(res, 502, { ok:false, error:"SUPABASE_ERROR", detail:r });
    }

    return json(res, 200, {
      ok:true,
      checklist: Array.isArray(r.data) ? r.data[0] : r.data
    });
  } catch (e) {
    return json(res, 500, {
      ok:false,
      error:"SERVER_ERROR",
      message:String(e?.message || e)
    });
  }
}
