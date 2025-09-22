// /api/generate.js
import { kv } from '@vercel/kv';

export const config = { runtime: 'edge' };

async function readJSON(req) {
  const text = await req.text();
  try { return JSON.parse(text || '{}'); } catch { return {}; }
}

export default async function handler(req) {
  try {
    const { prompt, username, userId, projectId } = await readJSON(req);

    if (!prompt || !username || !projectId) {
      return new Response(JSON.stringify({ error: 'BadRequest', message: 'Missing prompt/username/projectId' }), { status: 400 });
    }
    if (!process.env.GROQ_API_KEY) {
      return new Response(JSON.stringify({ error: 'MissingConfig', message: 'Missing GROQ_API_KEY. Contact support.' }), { status: 500 });
    }

    // Ask Groq to return a multi-file project (JSON manifest)
    const resp = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.GROQ_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'qwen/qwen3-32b',
        temperature: 0.6,
        messages: [
          {
            role: 'system',
            content:
`You are SimuWeb's code generator. Return a JSON object only (no markdown), with:
{
  "entry": "index.html",
  "files": [
    {"name":"index.html","content":"<html>...</html>"},
    {"name":"style.css","content":"..."},
    {"name":"app.js","content":"..."}
  ]
}
All HTML must be complete (doctype, head, body). References to CSS/JS must match files you return.`
          },
          {
            role: 'user',
            content: `Create a small working website for: ${prompt}.`
          }
        ]
      })
    });

    if (!resp.ok) {
      const detail = await resp.text();
      return new Response(JSON.stringify({ error: 'GroqError', message: 'Generation failed. Please try again. If this persists, contact support.', detail }), { status: resp.status });
    }

    const data = await resp.json();
    // Parse JSON manifest from assistant content
    let manifest;
    try {
      manifest = JSON.parse(data.choices?.[0]?.message?.content || '{}');
    } catch {
      // fallback: wrap raw content into one index.html file
      manifest = { entry: 'index.html', files: [{ name: 'index.html', content: data.choices?.[0]?.message?.content || '<!doctype html><title>Empty</title>' }] };
    }

    // Save to KV (if available)
    const versionKey = `project:${userId || username}:${projectId}:version`;
    const nextVersion = (await kv?.get(versionKey)) ? (await kv.get(versionKey)) + 1 : 1;
    if (kv) {
      await kv.set(versionKey, nextVersion);
      await kv.set(`project:${userId || username}:${projectId}:v${nextVersion}`, manifest);
      await kv.sadd(`projects:${userId || username}`, JSON.stringify({ projectId, lastVersion: nextVersion }));
    }

    return new Response(JSON.stringify({
      projectId,
      version: nextVersion,
      manifest
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });

  } catch (err) {
    return new Response(JSON.stringify({
      error: 'ServerError',
      message: 'We could not generate your site. Please try again. If this keeps happening, contact support.',
      detail: String(err)
    }), { status: 500 });
  }
}
