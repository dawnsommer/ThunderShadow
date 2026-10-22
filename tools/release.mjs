#!/usr/bin/env node
// No dependencies; run from any directory. --check validates without writing.
import { readFile, readdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = fileURLToPath(new URL("../", import.meta.url));
const check = process.argv.includes("--check");
if (process.argv.slice(2).some((arg) => arg !== "--check")) throw new Error("Usage: node tools/release.mjs [--check]");
const read = (file) => readFile(path.join(root, file), "utf8");
const outputs = new Map();
const worker = await read("service-worker.js");
const previous = Number(worker.match(/const VERSION = (\d+);/)?.[1]);
if (!Number.isSafeInteger(previous) || previous < 1) throw new Error("Missing service-worker release number.");
const version = check ? previous : previous + 1;
const oldAppVersion = (await read("VERSION")).trim();
const semver = oldAppVersion.match(/^(\d+)\.(\d+)\.(\d+)(.*)$/);
if (!semver) throw new Error("VERSION must contain major.minor.patch with an optional suffix.");
const appVersion = check ? oldAppVersion : `${semver[1]}.${semver[2]}.${Number(semver[3]) + 1}${semver[4]}`;
const prefix = "thundershadow-github-shell-";

async function filesIn(directory) {
  const entries = await readdir(path.join(root, directory), { withFileTypes: true });
  return (await Promise.all(entries.map((entry) => {
    const file = `${directory}/${entry.name}`;
    return entry.isDirectory() ? filesIn(file) : [file];
  }))).flat().sort();
}
const scripts = (await filesIn("js")).filter((file) => file.endsWith(".js"));
const styles = (await filesIn("css")).filter((file) => file.endsWith(".css"));
const assets = await filesIn("assets");
const runtime = new Set([...scripts, ...styles, ...assets, "manifest.json", "manifest.webmanifest"]);
const shell = ["./", "./index.html", "./privacy.html", ...[...runtime].sort().map((file) => `./${file}?v=${version}`), "./VERSION", "./release.json"];

function assetURL(reference, owner) {
  if (/^(?:[a-z][a-z\d+.-]*:|\/\/|#|\/)/i.test(reference)) return reference;
  const url = new URL(reference, `https://release.invalid/${owner}`);
  if (!runtime.has(decodeURIComponent(url.pathname.slice(1)))) return reference;
  url.searchParams.set("v", String(version));
  return reference.split(/[?#]/)[0] + url.search + url.hash;
}

for (const file of ["index.html", "privacy.html", ...scripts, ...styles]) {
  let source = (await read(file)).replace(/([?&]v=)\d+/g, (_, key) => `${key}${version}`);
  if (file.endsWith(".html")) {
    source = source.replace(/\b(src|href)=(['"])(.*?)\2/g, (_, attribute, quote, url) => `${attribute}=${quote}${assetURL(url, file)}${quote}`);
    source = source.replace(/(<meta name="thundershadow-build" content=")\d+(">)/, (_, start, end) => `${start}${version}${end}`);
  }
  if (file.endsWith(".css")) source = source.replace(/url\((['"]?)([^)'"\s]+)\1\)/g, (_, quote, url) => `url(${quote}${assetURL(url, file)}${quote})`);
  outputs.set(file, source);
}
for (const file of ["manifest.json", "manifest.webmanifest"]) {
  const manifest = JSON.parse(await read(file));
  for (const icon of manifest.icons || []) icon.src = assetURL(icon.src, file);
  outputs.set(file, JSON.stringify(manifest, null, 2) + "\n");
}
const generated = `// BEGIN GENERATED RELEASE (node tools/release.mjs)\nconst VERSION = ${version};\nconst APP_VERSION = ${JSON.stringify(appVersion)};\nconst PREFIX = ${JSON.stringify(prefix)};\nconst SHELL = ${JSON.stringify(shell, null, 2)};\n// END GENERATED RELEASE`;
for (const file of ["service-worker.js", "js/updates.js"]) {
  const source = outputs.get(file) ?? await read(file);
  const block = /^[ \t]*\/\/ BEGIN GENERATED RELEASE[^\n]*\n[\s\S]*?^[ \t]*\/\/ END GENERATED RELEASE/gm;
  if (!source.match(block)) throw new Error(`Missing generated release block: ${file}`);
  outputs.set(file, source.replace(block, (match) => {
    const indent = match.match(/^[ \t]*/)[0];
    return generated.split("\n").map((line) => indent + line).join("\n");
  }));
}
outputs.set("VERSION", appVersion + "\n");
outputs.set("release.json", JSON.stringify({ version, appVersion, cachePrefix: prefix, shell }, null, 2) + "\n");
for (const file of ["AGENTS.md", "README.md"]) {
  const source = await read(file);
  outputs.set(file, source.replace(/(Current release(?: is|:) )`[^`]+`/g, (_, start) => `${start}\`${appVersion}\``));
}

// Validate all generated references before writing anything.
for (const file of shell) {
  const pathname = file.split("?")[0].replace(/^\.\//, "");
  if (pathname && !outputs.has(pathname)) await readFile(path.join(root, pathname));
}
if (outputs.get("manifest.json") !== outputs.get("manifest.webmanifest")) throw new Error("PWA manifests differ.");
const html = outputs.get("index.html");
if (!html.includes(`name="thundershadow-build" content="${version}"`)) throw new Error("Missing HTML build marker.");
for (const match of html.matchAll(/<(?:script|link)\b[^>]*\b(?:src|href)="([^"]+\.(?:js|css)(?:\?[^"]*)?)"/g)) {
  if (new URL(match[1], "https://release.invalid/").searchParams.get("v") !== String(version)) throw new Error(`Unversioned code: ${match[1]}`);
}
let stale = false;
for (const [file, source] of outputs) {
  const current = await read(file).catch((error) => { if (error.code === "ENOENT") return null; throw error; });
  if (current === source) continue;
  if (check) { console.error(`Release metadata is stale: ${file}`); stale = true; }
  else await writeFile(path.join(root, file), source);
}
if (stale) process.exitCode = 1;
else console.log(`${check ? "Verified" : "Prepared"} ThunderShadow ${appVersion} · build ${version} (${shell.length} shell files).`);
