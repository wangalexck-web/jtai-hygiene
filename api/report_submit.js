export default async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      res.statusCode = 405;
      res.setHeader("content-type", "application/json; charset=utf-8");
      res.end(JSON.stringify({ ok: false, error: "METHOD_NOT_ALLOWED" }));
      return;
    }

    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!SUPABASE_URL || !SERVICE_ROLE) {
      res.statusCode = 500;
      res.setHeader("content-type", "application/json; charset=utf-8");
      res.end(JSON.stringify({ ok: false, error: "MISSING_ENV" }));
      return;
    }

    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
    const site_name = body.site_name || "JTAI";
    const area = body.area;
    const status = body.status;
    const note = body.note || null;

    if (!area || !status) {
      res.statusCode = 400;
      res.setHeader("content-type", "application/json; charset=utf-8");
      res.end(JSON.stringify({ ok: false, error: "BAD_REQUEST", message: "area/status required" }));
      return;
    }

    const url = `${SUPABASE_URL}/rest/v1/hygiene_reports`;
    const payload = [{ site_name, area, status, note }];

    const r = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "apikey": SERVICE_ROLE,
        "authorization": `Bearer ${SERVICE_ROLE}`,
        "prefer": "return=representation"
      },
      body: JSON.stringify(payload)
    });

    const text = await r.text();
    let data;
    try { data = JSON.parse(text); } catch { data = text; }

    if (!r.ok) {
      res.statusCode = 502;
      res.setHeader("content-type", "application/json; charset=utf-8");
      res.end(JSON.stringify({ ok: false, error: "SUPABASE_ERROR", detail: data }));
      return;
    }

    res.statusCode = 200;
    res.setHeader("content-type", "application/json; charset=utf-8");
    res.end(JSON.stringify({ ok: true, row: Array.isArray(data) ? data[0] : data }));
  } catch (e) {
    res.statusCode = 500;
    res.setHeader("content-type", "application/json; charset=utf-8");
    res.end(JSON.stringify({ ok: false, error: "SERVER_ERROR", message: String(e?.message || e) }));
  }
}
