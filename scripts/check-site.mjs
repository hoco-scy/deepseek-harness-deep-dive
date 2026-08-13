import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const docs = join(root, "docs");
const manifest = JSON.parse(readFileSync(join(root, "content", "chapters.json"), "utf8"));
const baseline = JSON.parse(readFileSync(join(root, "research", "baseline.json"), "utf8"));
const evidence = JSON.parse(readFileSync(join(root, "evidence", "catalog.json"), "utf8"));
const errors = [];

function assert(condition, message) {
  if (!condition) errors.push(message);
}

assert(existsSync(join(docs, "index.html")), "missing docs/index.html");
assert(baseline.commit === evidence.baseline, "baseline mismatch");

for (const chapter of manifest.chapters) {
  const path = join(docs, "pages", `${chapter.slug}.html`);
  assert(existsSync(path), `missing page: ${chapter.slug}`);
  if (!existsSync(path)) continue;
  const html = readFileSync(path, "utf8");
  assert(html.includes('<meta charset="UTF-8">'), `${chapter.slug}: missing UTF-8 meta`);
  assert(html.includes(`data-page="${chapter.slug}"`), `${chapter.slug}: wrong page identity`);
  assert(html.includes(`data-baseline="${baseline.commit}"`), `${chapter.slug}: missing baseline`);
  assert(html.includes("data-learning-notes"), `${chapter.slug}: missing learning notes`);
  assert(html.includes("data-chapter-jump"), `${chapter.slug}: missing chapter jump`);
  assert(html.includes('class="pagination"'), `${chapter.slug}: missing pagination`);
  assert(!html.includes("<evidence"), `${chapter.slug}: unresolved evidence tag`);
}

const evidenceIds = new Set(evidence.items.map((item) => item.id));
assert(evidenceIds.size === evidence.items.length, "duplicate evidence ids");
for (const item of evidence.items) {
  assert(/^\d+(?:-\d+)?$/.test(item.lines), `${item.id}: invalid line range`);
  assert(item.path.length > 0 && item.title.length > 0 && item.supports.length > 0, `${item.id}: incomplete evidence record`);
}

const tracked = execFileSync("git", ["ls-files", "-z"], { cwd: root }).toString("utf8").split("\0").filter(Boolean);
const textExtensions = new Set(["", ".css", ".html", ".js", ".json", ".md", ".mjs", ".yml", ".yaml"]);
const forbidden = [
  new RegExp(["insight", "flow"].join("[ -]?"), "i"),
  new RegExp(["go", "claw"].join(""), "i")
];
for (const relative of tracked) {
  if (!textExtensions.has(extname(relative))) continue;
  const text = readFileSync(join(root, relative), "utf8");
  for (const pattern of forbidden) {
    assert(!pattern.test(text), `${relative}: contains private-comparison identifier`);
  }
}

if (errors.length > 0) {
  console.error(errors.map((error) => `- ${error}`).join("\n"));
  process.exit(1);
}

console.log(`site-check-ok chapters=${manifest.chapters.length} evidence=${evidence.items.length} tracked=${tracked.length}`);
