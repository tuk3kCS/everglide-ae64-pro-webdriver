"use strict";

const fs = require("node:fs");
const path = require("node:path");

const releaseIdPattern = /^[a-zA-Z0-9][a-zA-Z0-9-]{0,95}$/;
const editions = [
  { file: "index.html", base: "./", route: "" },
  { file: "legacy/index.html", base: "../", route: "legacy/" },
];

function launcher(html, { file, base }) {
  // Keep the page title, search metadata and structured data in the public entry.
  const head = html.slice(0, html.indexOf("</head>"))
    .replace(/^[ \t]*<(?:base\b|link rel="stylesheet"\s|script src=)[^\n]*\n/gm, "");
  return `${head}
</head>
<body>
  <main>
    <h1>AE64 Pro Web Driver</h1>
    <p id="releaseStatus" role="status">Checking for the latest release…</p>
    <button id="retryRelease" type="button" hidden>Try again</button>
    <noscript><p>Enable JavaScript to open the driver.</p></noscript>
  </main>
  <script>
    const releaseStatus = document.querySelector("#releaseStatus");
    const retryRelease = document.querySelector("#retryRelease");
    retryRelease.onclick = () => location.reload();

    async function openLatestRelease() {
      const root = new URL(${JSON.stringify(base)}, location.href);
      const manifest = new URL("release.json", root);
      manifest.searchParams.set("check", Date.now().toString(36));
      const response = await fetch(manifest, { cache: "no-store", signal: AbortSignal.timeout(10000) });
      if (!response.ok) throw new Error("Release check failed.");
      const { release } = await response.json();
      if (typeof release !== "string" || !${releaseIdPattern}.test(release))
        throw new Error("Invalid release identifier.");
      const entry = new URL("_releases/" + release + "/" + ${JSON.stringify(file)}, root);
      entry.search = location.search;
      entry.hash = location.hash;
      location.replace(entry);
    }

    openLatestRelease().catch(() => {
      releaseStatus.textContent = "Could not load the current release. Try again.";
      retryRelease.hidden = false;
    });
  </script>
</body>
</html>
`;
}

function pinRuntime(html, { base, route }, release) {
  return html.replace(/^[ \t]*<base\b[^>]*>\r?\n/gm, "")
    .replace("<head>", `<head>
  <base href="${base}">
  <script>
  {
    // Resolve the release's assets before restoring the public address.
    const runtimeRoot = new URL(${JSON.stringify(base)}, location.href);
    document.querySelector("base").href = runtimeRoot.href;
    const publicEntry = new URL(${JSON.stringify(`../../${route}`)}, runtimeRoot);
    globalThis.AE64_PAGES_RELEASE = {
      id: ${JSON.stringify(release)},
      manifest: new URL("../../release.json", runtimeRoot).href,
    };
    publicEntry.search = location.search;
    publicEntry.hash = location.hash;
    history.replaceState(null, "", publicEntry);
  }
  </script>`)
    .replace(/href="legacy\//g, 'href="../../legacy/');
}

function versionPagesRelease(destination, release) {
  if (typeof release !== "string" || !releaseIdPattern.test(release))
    throw new Error("Pass a release identifier with letters, digits and hyphens.");
  const site = path.resolve(destination);
  const releases = path.join(site, "_releases");
  if (fs.existsSync(releases)) throw new Error("Package a fresh site before versioning it.");
  const pages = editions.map((edition) => ({
    ...edition,
    html: fs.readFileSync(path.join(site, edition.file), "utf8"),
  }));
  const alias = fs.readFileSync(path.join(site, "v2/index.html"));
  const about = fs.readFileSync(path.join(site, "about.html"), "utf8")
    .replace("<head>", `<head>\n  <base href="_releases/${release}/">`);
  const publicFiles = new Set(["robots.txt", "sitemap.xml", ".nojekyll"]);
  const runtime = fs.readdirSync(site).filter((name) => !publicFiles.has(name));
  const target = path.join(releases, release);
  fs.mkdirSync(target, { recursive: true });
  for (const name of runtime) fs.renameSync(path.join(site, name), path.join(target, name));

  for (const page of pages) {
    fs.writeFileSync(path.join(target, page.file), pinRuntime(page.html, page, release));
    fs.mkdirSync(path.dirname(path.join(site, page.file)), { recursive: true });
    fs.writeFileSync(path.join(site, page.file), launcher(page.html, page));
  }
  fs.mkdirSync(path.join(site, "v2"));
  fs.writeFileSync(path.join(site, "v2/index.html"), alias);
  fs.writeFileSync(path.join(site, "about.html"), about);
  fs.writeFileSync(path.join(site, "release.json"), JSON.stringify({ release }) + "\n");
}

if (require.main === module) {
  const [, , destination, release] = process.argv;
  versionPagesRelease(destination, release);
  console.log(`Packaged GitHub Pages release ${release}.`);
}

module.exports = { versionPagesRelease };
