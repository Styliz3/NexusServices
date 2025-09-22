// /api/projects.js
import { kv } from '@vercel/kv';
export const config = { runtime: 'edge' };

export default async function handler(req) {
  const { searchParams } = new URL(req.url);
  const userKey = searchParams.get('userKey'); // userId or username
  const projectId = searchParams.get('projectId');
  const version = searchParams.get('version');

  if (!kv) {
    return new Response(JSON.stringify({ error: 'NoKV', message: 'KV not configured' }), { status: 200 });
  }

  // GET /api/projects?userKey=...            -> list
  // GET /api/projects?userKey=...&projectId=...&version=1  -> specific version
  if (projectId && version) {
    const data = await kv.get(`project:${userKey}:${projectId}:v${version}`);
    return new Response(JSON.stringify(data || null), { status: 200 });
  }

  const list = await kv.smembers(`projects:${userKey}`);
  // Expand with latest version numbers
  const expanded = await Promise.all((list || []).map(async (json) => {
    const p = JSON.parse(json);
    const v = await kv.get(`project:${userKey}:${p.projectId}:version`);
    return { projectId: p.projectId, lastVersion: v || 1 };
  }));

  return new Response(JSON.stringify(expanded), { status: 200 });
}
