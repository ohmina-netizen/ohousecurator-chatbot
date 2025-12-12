function kvHeaders() {
  return {
    Authorization: `Bearer ${process.env.KV_REST_API_TOKEN}`,
  };
}

async function kvGet(key) {
  const base = process.env.KV_REST_API_URL;
  const url = `${base}/get/${encodeURIComponent(key)}`;
  const r = await fetch(url, { method: "GET", headers: kvHeaders() });
  if (!r.ok) throw new Error(`KV GET failed: ${r.status}`);
  return r.json();
}

export default async function handler(req, res) {
  try {
    if (req.method !== "GET") return res.status(405).send("Method Not Allowed");

    const requestId = (req.query.requestId ?? "").toString();
    if (!requestId) return res.status(400).json({ error: "missing requestId" });

    const out = await kvGet(requestId);
    const raw = out?.result;

    if (!raw) return res.status(404).json({ status: "not_found" });

    let v = null;
    try { v = JSON.parse(raw); } catch { v = { status: "error", error: "bad stored value" }; }

    if (v.status === "ready") return res.status(200).json({ status: "ready", answer: v.answer });
    if (v.status === "error") return res.status(200).json({ status: "error", error: v.error });

    return res.status(202).json({ status: "pending" });
  } catch (e) {
    return res.status(500).json({ status: "error", error: String(e?.message || e) });
  }
}
