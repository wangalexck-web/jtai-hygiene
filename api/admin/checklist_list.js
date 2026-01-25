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
  return { ok:r.ok, status:r.status, data };
}

export default async function handler(req, res) {
  try {
    if (req.method !== "GET") {
      return json(res, 405, { ok:false, error:"METHOD_NOT_ALLOWED" });
    }

    const adminToken = (process.env.ADMIN_TOKEN || "").trim();
    if (!adminToken) return json(res, 500, { ok:false, error:"ADMIN_TOKEN_NOT_SET" });

    const bearer = getBearerToken(req);
    if (!bearer) return json(res, 401, { ok:false, error:"MISSING_BEARER" });
    if (bearer !== adminToken) return json(res, 401, { ok:false, error:"UNAUTHORIZED" });

    const url = new URL(req.url, "http://localhost");
    const org_id = (url.searchParams.get("org_id") || "").trim();
    if (!org_id) {
      return json(res, 400, {
        ok:false,
        error:"BAD_REQUEST",
        message:"org_id required"
      });
    }

    const r = await sbGet(
      `checklists?org_id=eq.${encodeURIComponent(org_id)}&order=created_at.desc`
    );

    if (!r.ok) {
      return json(res, 502, { ok:false, error:"SUPABASE_ERROR", detail:r });
    }

    return json(res, 200, {
      ok:true,
      checklists: r.data
    });
  } catch (e) {
    return json(res, 500, {
      ok:false,
      error:"SERVER_ERROR",
      message:String(e?.message || e)
    });
  }
}
