// /api/generate.js
// CommonJS, Node runtime (no Edge). Works with vercel.json { "version": 2 }.
//
// ENV required:
// - GROQ_API_KEY
// Optional (for persistence):
// - KV_REST_API_URL
// - KV_REST_API_TOKEN
//
const fetch = global.fetch;
let kv = null;
try {
  // Only require @vercel/kv if it's installed; safe if KV not configured yet
  const mod = require("@vercel/kv");
  kv = mod?.kv || null;
} catch (_) {
  kv = null;
}

const MAX_FILES = 32;
const MAX_FILE_BYTES = 800 * 1024; // 800 KB per file (inline preview safety)

function hasKV() {
  return !!(kv && process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN);
}

function stripCodeFences(s = "") {
  // Remove typical ```json / ``` fences the model may emit
  // Leading fence:
  s = s.replace(/^\s*```(?:json|html|javascript|js)?\s*/i, "");
  // Trailing fence:
  s = s.replace(/\s*```\s*$/i, "");
  return s.trim();
}

async function readBody(req) {
  // Vercel Node serverless doesn't parse by default
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const txt = Buffer.concat(chunks).toString("utf8");
  try {
    return JSON.parse(txt || "{}");
  } catch {
    return {};
  }
}

function ensureHtmlDoctype(str) {
  const trimmed = (str || "").trim();
  if (!/^<!doctype html>/i.test(trimmed)) return "<!doctype html>\n" + trimmed;
  return trimmed;
}

function sanitizeManifest(m) {
  // Accept either {entry, files:[{name,content}]} or a plain HTML string
  if (!m || typeof m !== "object" || !Array.isArray(m.files)) {
    return {
      entry: "index.html",
      files: [{ name: "index.html", content: ensureHtmlDoctype(String(m || "")) }],
    };
  }

  // Cap file count & size; ensure strings
  const files = [];
  for (const f of m.files.slice(0, MAX_FILES)) {
    if (!f || typeof f.name !== "string") continue;
    let content = typeof f.content === "string" ? f.content : "";
    // enforce bytes cap
    const bytes = Buffer.byteLength(content, "utf8");
    if (bytes > MAX_FILE_BYTES) {
      content = content.slice(0, MAX_FILE_BYTES);
    }
    if (f.name.toLowerCase().endsWith(".html")) {
      content = ensureHtmlDoctype(content);
    }
    files.push({ name: f.name, content });
  }

  let entry = typeof m.entry === "string" ? m.entry : "index.html";
  if (!files.find((f) => f.name === entry)) {
    const firstHtml = files.find((f) => f.name.toLowerCase().endsWith(".html"));
    entry = firstHtml ? firstHtml.name : files[0]?.name || "index.html";
  }

  return { entry, files };
}

module.exports = async function handler(req, res) {
  try {
    // CORS (optional: relax if you need cross-domain calls from local dev)
    if (req.method === "OPTIONS") {
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
      return res.status(204).end();
    }

    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Content-Type", "application/json; charset=utf-8");

    if (req.method !== "POST") {
      return res.status(405).json({ error: "MethodNotAllowed", message: "Use POST /api/generate" });
    }

    const body = await readBody(req);
    const { prompt, username, userId, projectId, model } = body || {};

    if (!prompt || !username || !projectId) {
      return res.status(400).json({
        error: "BadRequest",
        message: "Missing fields. Required: prompt, username, projectId.",
      });
    }
    if (!process.env.GROQ_API_KEY) {
      return res.status(500).json({
        error: "MissingConfig",
        message: "Server misconfigured (missing GROQ_API_KEY). Contact support.",
      });
    }

    // --- Call Groq ---
    const groqResp = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: model || "qwen/qwen3-32b",
        temperature: 0.6,
        max_tokens: 4096,
        messages: [
          {
            role: "system",
            content:
              `Return ONLY JSON (no markdown), exactly like:
{
  "entry":"index.html",
  "files":[
    {"name":"index.html","content":"<!doctype html>..."},
    {"name":"style.css","content":"/* css */"},
    {"name":"app.js","content":"// js"}
  ]
}
Rules:
- Do not include backticks or code fences.
- All <link> and <script src> paths must match the "files" names you return.
- HTML files must be full HTML5 documents (doctype, head, body).
- Keep it concise and functional.`,
          },
          {
            role: "user",
            content: `Create a small, working website for: ${prompt}`,
          },
        ],
      }),
    });

    if (!groqResp.ok) {
      const detail = await groqResp.text();
      return res.status(groqResp.status).json({
        error: "GroqError",
        message: "Generation failed. Please try again. If this persists, contact support.",
        detail,
      });
    }

    const groqJson = await groqResp.json();
    let raw = groqJson?.choices?.[0]?.message?.content || "";
    raw = stripCodeFences(raw);

    let manifest;
    try {
      manifest = JSON.parse(raw);
    } catch {
      // Plain HTML fallback
      manifest = { entry: "index.html", files: [{ name: "index.html", content: raw || "" }] };
    }
    manifest = sanitizeManifest(manifest);

    // --- Persist (optional) ---
    const userKey = userId || username;
    let nextVersion = 1;
    if (hasKV()) {
      try {
        const versionKey = `project:${userKey}:${projectId}:version`;
        const cur = await kv.get(versionKey);
        nextVersion = (cur || 0) + 1;

        await kv.set(versionKey, nextVersion);
        await kv.set(`project:${userKey}:${projectId}:v${nextVersion}`, manifest);
        await kv.sadd(`projects:${userKey}`, JSON.stringify({ projectId }));
      } catch (e) {
        // KV is optional; if it fails, still return the content
        console.warn("KV persist failed:", e);
      }
    }

    return res.status(200).json({ projectId, version: nextVersion, manifest });
  } catch (err) {
    console.error("generate error:", err);
    return res.status(500).json({
      error: "ServerError",
      message: "We couldn't generate your site. Please try again. If this continues, contact support.",
      detail: String(err && err.stack ? err.stack : err),
    });
  }
};
