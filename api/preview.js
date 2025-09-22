async function renderProject(project) {
  const container = document.getElementById("previewContainer");
  container.innerHTML = "Crafting your site...";

  // Get project files from KV
  const res = await fetch(`/api/projects?id=${project.id}`);
  const data = await res.json();

  if (!data.files || data.files.length === 0) {
    container.innerHTML = "No files found!";
    return;
  }

  // Create a fake filesystem in memory
  let files = {};
  data.files.forEach(file => {
    files[file.name] = file.content;
  });

  // Build entry HTML (replace links with inline Blobs)
  let html = files[data.entry];
  if (!html) {
    container.innerHTML = "Missing entry file!";
    return;
  }

  // Replace <link> and <script> with blob URLs
  Object.keys(files).forEach(name => {
    if (name.endsWith(".css")) {
      let blob = new Blob([files[name]], { type: "text/css" });
      let url = URL.createObjectURL(blob);
      html = html.replace(`href="${name}"`, `href="${url}"`);
    }
    if (name.endsWith(".js")) {
      let blob = new Blob([files[name]], { type: "application/javascript" });
      let url = URL.createObjectURL(blob);
      html = html.replace(`src="${name}"`, `src="${url}"`);
    }
  });

  // Render in iframe
  let blob = new Blob([html], { type: "text/html" });
  let url = URL.createObjectURL(blob);

  container.innerHTML = `<iframe src="${url}" class="preview-frame"></iframe>`;
}
