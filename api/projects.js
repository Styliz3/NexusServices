// /api/projects.js
import { kv } from "@vercel/kv";

export default async function handler(req, res) {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const userKey = url.searchParams.get("userKey");
    const projectId = url.searchParams.get("projectId");
    const version = url.searchParams.get("version");

    if (!userKey) return res.status(400).json({ error: "BadRequest", message: "Missing userKey" });

    if (projectId && version) {
      const data = kv ? await kv.get(`project:${userKey}:${projectId}:v${version}`) : null;
      return res.status(200).json(data || null);
    }

    if (!kv) return res.status(200).json([]); // no KV configured yet

    const set = await kv.smembers(`projects:${userKey}`);
    const items = await Promise.all(
      (set || []).map(async (j) => {
        const p = JSON.parse(j);
        const v = await kv.get(`project:${userKey}:${p.projectId}:version`);
        return { projectId: p.projectId, lastVersion: v || 1 };
      })
    );
    return res.status(200).json(items);
  } catch (e) {
    return res.status(500).json({ error: "ServerError", message: "Failed to load projects", detail: String(e) });
  }
}
