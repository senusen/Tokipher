// Downloads yt-dlp/ejs (the YouTube signature/n-param solver) into vendor/ejs.
//
//   npm run update-ejs            -> latest commit on main
//   npm run update-ejs -- <ref>   -> a specific commit, tag or branch

import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";

const REPO = "yt-dlp/ejs";
const ROOT = join(import.meta.dirname, "..");
const VENDOR_DIR = join(ROOT, "vendor", "ejs");
const ref = process.argv[2] ?? "main";

async function github(path: string): Promise<any> {
  const res = await fetch(`https://api.github.com/repos/${REPO}/${path}`, {
    headers: { Accept: "application/vnd.github+json", "User-Agent": "tokipher" },
  });
  if (!res.ok) throw new Error(`GitHub API ${path} -> ${res.status} ${await res.text()}`);
  return res.json();
}

async function raw(sha: string, path: string): Promise<string> {
  const res = await fetch(`https://raw.githubusercontent.com/${REPO}/${sha}/${path}`);
  if (!res.ok) throw new Error(`Download ${path} -> ${res.status}`);
  return res.text();
}

const commit = await github(`commits/${encodeURIComponent(ref)}`);
const sha: string = commit.sha;
console.log(`Resolved ${REPO}@${ref} -> ${sha.slice(0, 7)} (${commit.commit.committer.date})`);

const tree = await github(`git/trees/${sha}?recursive=1`);
const files: string[] = tree.tree
  .filter((e: { type: string; path: string }) => e.type === "blob")
  .map((e: { path: string }) => e.path)
  .filter((p: string) => p.startsWith("src/") && p.endsWith(".ts"))
  .filter((p: string) => !p.includes("/test/") && !p.endsWith(".test.ts"));

await rm(VENDOR_DIR, { recursive: true, force: true });
for (const file of [...files, "LICENSE", "package.json"]) {
  const target = join(VENDOR_DIR, file);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, await raw(sha, file));
  console.log(`  ${file}`);
}
await writeFile(
  join(VENDOR_DIR, "VERSION.json"),
  JSON.stringify({ repo: REPO, ref, sha, date: commit.commit.committer.date }, null, 2) + "\n",
);

// ejs pins exact meriyah/astring versions; ours must match.
const ejsDeps = JSON.parse(await readFile(join(VENDOR_DIR, "package.json"), "utf8")).dependencies ?? {};
const ourDeps = JSON.parse(await readFile(join(ROOT, "package.json"), "utf8")).dependencies ?? {};
for (const [name, version] of Object.entries(ejsDeps)) {
  if (ourDeps[name] !== version) {
    console.warn(`!! ejs needs ${name}@${version} but package.json has ${ourDeps[name] ?? "nothing"}.`);
    console.warn(`   Run: npm install ${name}@${version} --save-exact`);
  }
}

// Make sure the solver still loads under Node's TypeScript support.
const check = spawnSync(
  process.execPath,
  ["--input-type=module", "-e", `await import(${JSON.stringify(new URL("../vendor/ejs/src/yt/solver/solvers.ts", import.meta.url).href)})`],
  { stdio: "inherit" },
);
if (check.status !== 0) {
  console.error("!! The updated solver failed to load. Pin an older ref: npm run update-ejs -- <sha>");
  process.exit(1);
}
console.log("ejs updated. Restart Tokipher to use it.");
