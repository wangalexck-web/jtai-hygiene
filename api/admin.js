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

async function sbFetch(path, { method = "GET", body = null, prefer = null } = {}) {
  const SUPABASE_URL = mustEnv("SUPABASE_URL");
  const SERVICE_ROLE = mustEnv("SUPABASE_SERVICE_ROLE_KEY");

  const headers = {
    "apikey": SERVICE_ROLE,
    "authorization": `Bearer ${SERVICE_ROLE}`,
  };
  if (body) headers["content-type"] = "application/json";
  if (prefer) headers["prefer"] = prefer;

  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  const text = await r.text();
  let data;
  try { data = JSON.parse(text); } catch { data = text; }
  return { ok: r.ok, status: r.status, data };
}

// ---- helpers ----
function pick(obj, keys) {
  const out = {};
  for (const k of keys) out[k] = obj[k];
  return out;
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
    const action = (body.action || "").trim();
    const data = body.data || {};

    if (!action) return json(res, 400, { ok: false, error: "BAD_REQUEST", message: "action required" });

    // ---- ACTIONS ----
    // 1) org_create
    if (action === "org_create") {
      const org_name = (data.org_name || data.name || "").trim();
      if (!org_name) return json(res, 400, { ok:false, error:"BAD_REQUEST", message:"org_name required" });

      const r = await sbFetch("orgs", { method: "POST", prefer: "return=representation", body: [{
        name: org_name,
        is_active: data.is_active === false ? false : true
      }]});

      if (!r.ok) return json(res, 502, { ok:false, error:"SUPABASE_ERROR", detail:r });
      return json(res, 200, { ok:true, org: r.data?.[0] || null });
    }

    // 2) org_list
    if (action === "org_list") {
      const r = await sbFetch("orgs?select=id,name,is_active,created_at&order=created_at.desc");
      if (!r.ok) return json(res, 502, { ok:false, error:"SUPABASE_ERROR", detail:r });
      return json(res, 200, { ok:true, orgs: r.data || [] });
    }

    // 3) checklist_ping
    if (action === "checklist_ping") {
      const r = await sbFetch("checklists?select=*&limit=1");
      return json(res, 200, { ok:true, supabase: r });
    }

    // 4) checklist_create
    if (action === "checklist_create") {
      const org_id = (data.org_id || "").trim();
      const name = (data.name || "").trim();
      const description = (data.description || "").trim();
      const is_active = data.is_active === false ? false : true;
      if (!org_id || !name) return json(res, 400, { ok:false, error:"BAD_REQUEST", message:"org_id + name required" });

      const r = await sbFetch("checklists", { method:"POST", prefer:"return=representation", body:[{
        org_id,
        name,
        description: description || null,
        is_active
      }]});

      if (!r.ok) return json(res, 502, { ok:false, error:"SUPABASE_ERROR", detail:r });
      return json(res, 200, { ok:true, checklist: r.data?.[0] || null });
    }

    // 5) checklist_list
    if (action === "checklist_list") {
      const org_id = (data.org_id || "").trim();
      if (!org_id) return json(res, 400, { ok:false, error:"BAD_REQUEST", message:"org_id required" });

      const r = await sbFetch(`checklists?org_id=eq.${encodeURIComponent(org_id)}&order=created_at.desc`);
      if (!r.ok) return json(res, 502, { ok:false, error:"SUPABASE_ERROR", detail:r });
      return json(res, 200, { ok:true, checklists: r.data || [] });
    }

    // 6) site_upsert (最小版：只寫入 name / is_active / org_id)
    if (action === "site_upsert") {
      const org_id = (data.org_id || "").trim();
      const name = (data.name || "").trim();
      const is_active = data.is_active === false ? false : true;
      if (!org_id || !name) return json(res, 400, { ok:false, error:"BAD_REQUEST", message:"org_id + name required" });

      const r = await sbFetch("sites", { method:"POST", prefer:"return=representation", body:[{
        org_id,
        name,
        is_active
      }]});

      if (!r.ok) return json(res, 502, { ok:false, error:"SUPABASE_ERROR", detail:r });
      return json(res, 200, { ok:true, site: r.data?.[0] || null });
    }

    // 7) site_list
    if (action === "site_list") {
      const org_id = (data.org_id || "").trim();
      if (!org_id) return json(res, 400, { ok:false, error:"BAD_REQUEST", message:"org_id required" });

      const r = await sbFetch(`sites?org_id=eq.${encodeURIComponent(org_id)}&order=created_at.desc`);
      if (!r.ok) return json(res, 502, { ok:false, error:"SUPABASE_ERROR", detail:r });
      return json(res, 200, { ok:true, sites: r.data || [] });
    }

    // 8) report_list（先沿用你目前 report_list 的資料結構，避免改 UI）
    if (action === "report_list") {
      const org_id = (data.org_id || "").trim(); // 允許空：回全部（你也可以強制必填）
      const limit = Number.isFinite(+data.limit) ? Math.max(1, Math.min(200, +data.limit)) : 20;

      let path = `hygiene_reports?select=id,created_at,site_name,area,status,note&order=created_at.desc&limit=${limit}`;
      // 若你的 hygiene_reports 沒 org_id 欄位，就不要加過濾（你先前遇過 org_id 不存在）
      // 所以這裡先不加 filter，保持能跑。
      const r = await sbFetch(path);
      if (!r.ok) return json(res, 502, { ok:false, error:"SUPABASE_ERROR", detail:r });
      return json(res, 200, { ok:true, reports: r.data || [] });
    }

    return json(res, 400, { ok:false, error:"UNKNOWN_ACTION", action });

  } catch (e) {
    return json(res, 500, { ok:false, error:"SERVER_ERROR", message:String(e?.message || e) });
  }
}
