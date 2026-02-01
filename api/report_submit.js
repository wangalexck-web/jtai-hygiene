// api/report_submit.js  (M1.5: report + optional photos upload to Supabase Storage)
// - Accepts JSON body:
//   {
//     "site_name":"JTAI",
//     "area":"廁所",
//     "status":"OK",
//     "note":"...",
//     "photos":[
//        { "filename":"toilet1.jpg", "contentType":"image/jpeg", "dataBase64":"...." },
//        ...
//     ]
//   }

function send(res, status, obj) {
  res.statusCode = status;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.end(JSON.stringify(obj));
}

function safeJsonParse(x) {
  try { return JSON.parse(x); } catch { return null; }
}

function sanitizeFileName(name) {
  return String(name || "photo")
    .replace(/[^\w.\-]+/g, "_")
    .slice(0, 80);
}

function extFromMime(mime) {
  const m = String(mime || "").toLowerCase();
  if (m.includes("jpeg") || m.includes("jpg")) return "jpg";
  if (m.includes("png")) return "png";
  if (m.includes("webp")) return "webp";
  if (m.includes("heic")) return "heic";
  return "bin";
}

async function readRawBody(req) {
  return await new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => (data += chunk));
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

async function supabaseInsertReport({ SUPABASE_URL, SERVICE_ROLE, payload }) {
  const url = `${SUPABASE_URL}/rest/v1/hygiene_reports`;
  const r = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      apikey: SERVICE_ROLE,
      authorization: `Bearer ${SERVICE_ROLE}`,
      prefer: "return=representation",
    },
    body: JSON.stringify(payload),
  });

  const text = await r.text();
  const data = safeJsonParse(text) ?? text;

  if (!r.ok) {
    return { ok: false, status: r.status, detail: data };
  }
  const row = Array.isArray(data) ? data[0] : data;
  return { ok: true, row };
}

async function supabaseUploadToStorage({ SUPABASE_URL, SERVICE_ROLE, bucket, path, contentType, bytes }) {
  // PUT /storage/v1/object/<bucket>/<path>
  const url = `${SUPABASE_URL}/storage/v1/object/${encodeURIComponent(bucket)}/${path}`;
  const r = await fetch(url, {
    method: "POST", // POST works for new object; PUT also ok depending on config
    headers: {
      apikey: SERVICE_ROLE,
      authorization: `Bearer ${SERVICE_ROLE}`,
      "content-type": contentType || "application/octet-stream",
      "x-upsert": "true",
    },
    body: bytes,
  });

  const text = await r.text();
  const data = safeJsonParse(text) ?? text;

  if (!r.ok) return { ok: false, status: r.status, detail: data };
  return { ok: true };
}

async function supabaseInsertPhotoRow({ SUPABASE_URL, SERVICE_ROLE, photoRow }) {
  const url = `${SUPABASE_URL}/rest/v1/report_photos`;
  const r = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      apikey: SERVICE_ROLE,
      authorization: `Bearer ${SERVICE_ROLE}`,
      prefer: "return=representation",
    },
    body: JSON.stringify(photoRow),
  });

  const text = await r.text();
  const data = safeJsonParse(text) ?? text;

  if (!r.ok) return { ok: false, status: r.status, detail: data };
  const row = Array.isArray(data) ? data[0] : data;
  return { ok: true, row };
}

async function supabaseSignUrl({ SUPABASE_URL, SERVICE_ROLE, bucket, path, expiresIn = 3600 }) {
  // POST /storage/v1/object/sign/<bucket>/<path>
  const url = `${SUPABASE_URL}/storage/v1/object/sign/${encodeURIComponent(bucket)}/${path}`;
  const r = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      apikey: SERVICE_ROLE,
      authorization: `Bearer ${SERVICE_ROLE}`,
    },
    body: JSON.stringify({ expiresIn }),
  });

  const text = await r.text();
  const data = safeJsonParse(text) ?? text;

  if (!r.ok) return { ok: false, status: r.status, detail: data };
  // data: { signedURL: "/storage/v1/object/sign/...." }
  const signedURL = data?.signedURL;
  if (!signedURL) return { ok: false, status: 500, detail: data };
  return { ok: true, url: `${SUPABASE_URL}${signedURL}` };
}

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") return send(res, 405, { ok: false, error: "METHOD_NOT_ALLOWED" });

    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!SUPABASE_URL || !SERVICE_ROLE) {
      return send(res, 500, { ok: false, error: "MISSING_ENV" });
    }

    const raw = await readRawBody(req);
    const body = (typeof raw === "string" && raw.length) ? (safeJsonParse(raw) ?? {}) : {};
    const site_name = body.site_name || "JTAI";
    const area = body.area;
    const status = body.status;
    const note = body.note ?? null;

    if (!area || !status) {
      return send(res, 400, { ok: false, error: "BAD_REQUEST", message: "area/status required" });
    }

    // 1) Insert hygiene report
    const payload = { site_name, area, status, note };
    const ins = await supabaseInsertReport({ SUPABASE_URL, SERVICE_ROLE, payload });
    if (!ins.ok) return send(res, 502, { ok: false, error: "SUPABASE_ERROR", step: "insert_report", detail: ins.detail });

    const report = ins.row;
    const reportId = report?.id;
    if (!reportId) return send(res, 500, { ok: false, error: "NO_REPORT_ID" });

    // 2) Optional photos upload
    const bucket = "hygiene-photos";
    const photos = Array.isArray(body.photos) ? body.photos : [];
    const savedPhotos = [];

    for (let i = 0; i < photos.length; i++) {
      const p = photos[i] || {};
      const contentType = p.contentType || "application/octet-stream";
      const base64 = p.dataBase64;
      if (!base64) continue;

      // Decode base64
      const bytes = Buffer.from(String(base64), "base64");

      const ext = extFromMime(contentType);
      const fn = sanitizeFileName(p.filename || `photo_${i + 1}.${ext}`);
      const ts = new Date().toISOString().replace(/[:.]/g, "-");
      const path = `reports/${reportId}/${ts}_${fn}`;

      const up = await supabaseUploadToStorage({ SUPABASE_URL, SERVICE_ROLE, bucket, path, contentType, bytes });
      if (!up.ok) {
        return send(res, 502, { ok: false, error: "SUPABASE_STORAGE_ERROR", step: "upload_photo", detail: up.detail });
      }

      const pr = await supabaseInsertPhotoRow({
        SUPABASE_URL,
        SERVICE_ROLE,
        photoRow: {
          report_id: reportId,
          bucket,
          path,
          mime: contentType,
          size_bytes: bytes.length,
        },
      });

      if (!pr.ok) {
        return send(res, 502, { ok: false, error: "SUPABASE_ERROR", step: "insert_photo_row", detail: pr.detail });
      }

      // Return signed URL (default 1hr)
      const su = await supabaseSignUrl({ SUPABASE_URL, SERVICE_ROLE, bucket, path, expiresIn: 3600 });
      savedPhotos.push({
        id: pr.row?.id,
        bucket,
        path,
        mime: contentType,
        size_bytes: bytes.length,
        signed_url: su.ok ? su.url : null,
      });
    }

    return send(res, 200, { ok: true, report, photos: savedPhotos });
  } catch (e) {
    return send(res, 500, { ok: false, error: "SERVER_ERROR", message: String(e?.message || e) });
  }
}
