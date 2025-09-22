let currentProjectId = null;
let user = null; // set from session in your main script

/* ---------------- Helpers ---------------- */
const $ = id => document.getElementById(id);

function sanitize(s) {
  return (s || "").replace(/[^\w\-.]/g, "_");
}

function toast(kind, title, msg) {
  const t = document.createElement("div");
  t.className = `toast ${kind}`;
  t.innerHTML = `<h4>${title}</h4><p>${msg || ""}</p>`;
  $("toasts").appendChild(t);
  setTimeout(() => t.remove(), 6000);
}

/* ---------------- Project List ---------------- */
async function loadProjects() {
  try {
    const userKey = encodeURIComponent(user?.userId || user?.username || "guest");
    const res = await fetch(`/api/projects?userKey=${userKey}`);
    const list = await res.json();
    renderProjectIndex(list);
  } catch {
    renderProjectIndex([]);
  }
}

function renderProjectIndex(list) {
  const root = $("list");
  root.innerHTML = "";
  if (!list || !list.length) {
    const e = document.createElement("div");
    e.className = "empty";
    e.textContent = "No projects yet";
    root.appendChild(e);
    return;
  }

  list.forEach(p => {
    const el = document.createElement("div");
    el.className = "proj";
    el.innerHTML = `<span>${p.projectId}</span><span class="pill">v${p.lastVersion}</span>`;
    el.onclick = async () => {
      const res = await fetch(
        `/api/projects?userKey=${encodeURIComponent(
          user?.userId || user?.username
        )}&projectId=${encodeURIComponent(p.projectId)}&version=${encodeURIComponent(
          p.lastVersion
        )}`
      );
      const manifest = await res.json();
      await renderManifestToPreview(manifest);

      const uname = sanitize(user?.username || "guest");
      history.pushState(
        {},
        "",
        `${location.origin}/@${uname}/${p.projectId}/${p.lastVersion}`
      );
      currentProjectId = p.projectId;
    };
    root.appendChild(el);
  });
}

/* ---------------- Manifest → Iframe ---------------- */
async function bundleManifest(manifest) {
  if (!manifest || !manifest.files) {
    return { html: String(manifest || "<!doctype html><title>Empty</title>") };
  }
  const map = new Map(manifest.files.map(f => [f.name, f.content]));
  const entry = manifest.entry || "index.html";
  let entryHtml =
    map.get(entry) ||
    [...map.entries()].find(([n]) => n.endsWith(".html"))?.[1] ||
    "<!doctype html><title>Empty</title>";

  if (!/^<!doctype html>/i.test(entryHtml.trim()))
    entryHtml = "<!doctype html>\n" + entryHtml;

  const parser = new DOMParser();
  const doc = parser.parseFromString(entryHtml, "text/html");

  // inline CSS
  doc.querySelectorAll("link[rel=stylesheet][href]").forEach(link => {
    const href = link.getAttribute("href");
    const css = map.get(href);
    if (css != null) {
      const style = doc.createElement("style");
      style.textContent = css;
      link.replaceWith(style);
    }
  });

  // inline JS
  doc.querySelectorAll("script[src]").forEach(script => {
    const src = script.getAttribute("src");
    const js = map.get(src);
    if (js != null) {
      const s = doc.createElement("script");
      const t = script.getAttribute("type");
      if (t) s.type = t;
      s.textContent = js;
      script.replaceWith(s);
    }
  });

  const html = "<!DOCTYPE html>\n" + doc.documentElement.outerHTML;
  return { html };
}

async function renderManifestToPreview(manifest) {
  const { html } = await bundleManifest(manifest);
  $("placeholder").classList.add("hidden");
  const f = $("frame");
  f.style.display = "block";
  f.srcdoc = html;
}

/* ---------------- New Project ---------------- */
function createNewProject() {
  currentProjectId = "proj" + Date.now();
  const uname = sanitize(user?.username || "guest");
  history.replaceState({}, "", `${location.origin}/@${uname}/${currentProjectId}`);
  toast("ok", "New project", `Project ${currentProjectId} created`);
}

/* ---------------- Progress Display ---------------- */
function showWriteProgress(files) {
  const root = $("list");
  root.innerHTML = "";
  (files || []).forEach(f => {
    const row = document.createElement("div");
    row.className = "proj";
    row.innerHTML = `<span>Writing ${f.name}</span><span class="pill">…</span>`;
    root.appendChild(row);
  });
}

/* ---------------- Deep Link Loader ---------------- */
async function maybeLoadDeepLink() {
  const parts = location.pathname.split("/").filter(Boolean);
  if (parts[0]?.startsWith("@") && parts.length >= 3) {
    const usernameInUrl = parts[0].slice(1);
    const pid = parts[1];
    const ver = parts[2];
    if (!user) return;
    try {
      const res = await fetch(
        `/api/projects?userKey=${encodeURIComponent(
          user?.userId || usernameInUrl
        )}&projectId=${encodeURIComponent(pid)}&version=${encodeURIComponent(ver)}`
      );
      if (res.ok) {
        const manifest = await res.json();
        if (manifest?.files?.length) {
          await renderManifestToPreview(manifest);
          $("route-builder").classList.remove("hidden");
          $("dock").style.display = "flex";
          currentProjectId = pid;
        }
      }
    } catch {}
  }
}

/* ---------------- Export for index.html ---------------- */
window.SimuWebPreview = {
  loadProjects,
  renderProjectIndex,
  renderManifestToPreview,
  createNewProject,
  showWriteProgress,
  maybeLoadDeepLink
};
