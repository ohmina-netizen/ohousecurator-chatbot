import { kv } from "@vercel/kv";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  try {
    const { requestId, answer, from } = req.body;

    if (!requestId || !answer) {
      return res.status(400).json({ error: "Missing requestId or answer" });
    }

    // KV에 최종 결과 저장
    await kv.set(`chat:${requestId}`, {
      status: "done",
      answer,
      from,
      completedAt: Date.now(),
    });

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error("complete error:", err);
    return res.status(500).json({ error: "Internal Server Error" });
  }
}
