// /api/generate.js
// CommonJS. No custom runtime exports. No KV import (so it builds cleanly).

const fetch = global.fetch;

async function readBody(req) {
  return new Promise((resolve) => {
    let data = "";
    req.on("data", (c) => (data += c));
    req.on("end", () => {
      try { resolve(JSON.parse(data || "{}")); } catch { resolve({}); }
    });
  });
}

function stripCodeFences(s = "") {
  return s
    .replace(/^\s*```(?:json|html|javascript|js)?\s*/i, "")
    .replace(/\s*```\s*$/i, "")
    .trim();
}

function ensureHtmlDoctype(str) {
  const t = String(str || "").trim();
  return /^<!doctype html>/i.test(t) ? t : "<!doctype html>\n" + t;
}

function toManifest(raw) {
  // Accept JSON manifest or plain HTML
  try {
    const m = JSON.parse(raw);
    if (m && Array.isArray(m.files)) {
      // normalize html files
      m.files = m.files.map(f => {
        if (typeof f?.name === "string" && typeof f?.content === "string") {
          if (f.name.toLowerCase().endsWith(".html")) f.content = ensureHtmlDoctype(f.content);
          return { name: f.name, content: f.content };
        }
        return null;
      }).filter(Boolean);
      m.entry = typeof m.entry === "string" ? m.entry : (m.files.find(x => x.name.endsWith(".html"))?.name || "index.html");
      return m;
    }
  } catch { /* fall through */ }
  // Plain HTML fallback
  return {
    entry: "index.html",
    files: [{ name: "index.html", content: ensureHtmlDoctype(raw) }]
  };
}

module.exports = async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      return res.status(405).json({ error: "MethodNotAllowed", message: "Use POST" });
    }

    const { prompt, username, projectId, model } = await readBody(req);
    if (!prompt || !username || !projectId) {
      return res.status(400).json({ error: "BadRequest", message: "Missing prompt/username/projectId" });
    }
    if (!process.env.GROQ_API_KEY) {
      return res.status(500).json({ error: "MissingConfig", message: "Missing GROQ_API_KEY" });
    }

    const groq = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.GROQ_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: model || "qwen/qwen3-32b",
        temperature: 0.6,
        max_tokens: 4096,
        messages: [
          {
            role: "system",
            content:
`Return ONLY JSON (no markdown) like:
{"entry":"index.html","files":[{"name":"index.html","content":"<!doctype html>..."},{"name":"style.css","content":"/* css */"},{"name":"app.js","content":"// js"}]}
- Do not include backticks.
- <link>/<script src> must match file names you return.
- HTML must be full documents (doctype, head, body).`
          },
          { role: "user", content: `Create a small working website for: ${prompt}` }
        ]
      })
    });

    if (!groq.ok) {
      const detail = await groq.text();
      return res.status(groq.status).json({ error: "GroqError", message: "Generation failed", detail });
    }

    const data = await groq.json();
    let raw = stripCodeFences(data?.choices?.[0]?.message?.content || "");
    const manifest = toManifest(raw);

    // (Optional) persist later; for now just return it:
    return res.status(200).json({ projectId, version: 1, manifest });
  } catch (err) {
    return res.status(500).json({
      error: "ServerError",
      message: "We couldn't generate your site. Please try again.",
      detail: String(err)
    });
  }
};
