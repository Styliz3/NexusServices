// /api/generate.js
import { kv } from "@vercel/kv";

async function readJson(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const txt = Buffer.concat(chunks).toString("utf8");
  try { return JSON.parse(txt || "{}"); } catch { return {}; }
}

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      return res.status(405).json({ error: "MethodNotAllowed" });
    }

    const { prompt, username, userId, projectId, model } = await readJson(req);
    if (!prompt || !username || !projectId) {
      return res.status(400).json({ error: "BadRequest", message: "Missing prompt/username/projectId" });
    }
    if (!process.env.GROQ_API_KEY) {
      return res.status(500).json({ error: "MissingConfig", message: "Missing GROQ_API_KEY. Contact support." });
    }

    // Ask Groq for a multi-file MANIFEST
    const groq = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.GROQ_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: model || "qwen/qwen3-32b",
        temperature: 0.6,
        messages: [
          {
            role: "system",
            content:
`Return ONLY JSON (no markdown) in this shape:
{"entry":"index.html","files":[{"name":"index.html","content":"<!doctype html>..."},{"name":"style.css","content":"..."},{"name":"app.js","content":"..."}]}
All file references in HTML must match files you include.`
          },
          { role: "user", content: `Create a small working website for: ${prompt}.` }
        ]
      })
    });

    if (!groq.ok) {
      const detail = await groq.text();
      return res.status(groq.status).json({
        error: "GroqError",
        message: "Generation failed. Please try again. If this persists, contact support.",
        detail
      });
    }

    const data = await groq.json();
    let manifest;
    try {
      manifest = JSON.parse(data?.choices?.[0]?.message?.content || "{}");
    } catch {
      // fallback: single HTML
      manifest = {
        entry: "index.html",
        files: [{ name: "index.html", content: data?.choices?.[0]?.message?.content || "<!doctype html><title>Empty</title>" }]
      };
    }

    // Persist to KV (if configured)
    const userKey = userId || username;
    let nextVersion = 1;
    if (kv) {
      const versionKey = `project:${userKey}:${projectId}:version`;
      const cur = await kv.get(versionKey);
      nextVersion = (cur || 0) + 1;

      await kv.set(versionKey, nextVersion);
      await kv.set(`project:${userKey}:${projectId}:v${nextVersion}`, manifest);
      await kv.sadd(`projects:${userKey}`, JSON.stringify({ projectId }));
    }

    return res.status(200).json({ projectId, version: nextVersion, manifest });
  } catch (err) {
    return res.status(500).json({
      error: "ServerError",
      message: "We couldn't generate your site. Please try again. If this continues, contact support.",
      detail: String(err)
    });
  }
}
