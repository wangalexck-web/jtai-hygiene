export default function handler(req, res) {
  res.statusCode = 200;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.end(JSON.stringify({
    ok: true,
    service: "jtai-hygiene",
    ts: new Date().toISOString()
  }));
}

// redeploy trigger

