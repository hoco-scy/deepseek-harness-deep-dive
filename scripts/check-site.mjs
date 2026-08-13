import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const docs = join(root, "docs");
const content = join(root, "content");
const manifests = {
  en: JSON.parse(readFileSync(join(content, "chapters.en.json"), "utf8")),
  zh: JSON.parse(readFileSync(join(content, "chapters.json"), "utf8")),
};
const baseline = JSON.parse(readFileSync(join(root, "research", "baseline.json"), "utf8"));
const evidence = JSON.parse(readFileSync(join(root, "evidence", "catalog.json"), "utf8"));
const errors = [];
function assert(condition, message) { if (!condition) errors.push(message); }

assert(existsSync(join(docs, "index.html")), "missing default English docs/index.html");
assert(existsSync(join(docs, "zh", "index.html")), "missing Chinese docs/zh/index.html");
assert(baseline.commit === evidence.baseline, "baseline mismatch");

const enShape = manifests.en.chapters.map(({ id, slug, status }) => ({ id, slug, status }));
const zhShape = manifests.zh.chapters.map(({ id, slug, status }) => ({ id, slug, status }));
assert(JSON.stringify(enShape) === JSON.stringify(zhShape), "English and Chinese chapter manifests diverge");

for (const chapter of manifests.en.chapters) {
  const zhChapter = manifests.zh.chapters.find((item) => item.id === chapter.id);
  const enSource = join(content, "en", `${chapter.id}-${chapter.slug}.html`);
  const zhSource = join(content, `${chapter.id}-${chapter.slug}.html`);
  assert(existsSync(enSource) === existsSync(zhSource), `${chapter.slug}: substantive content exists in only one language`);
  if (chapter.status === "verified") {
    assert(existsSync(enSource) && existsSync(zhSource), `${chapter.slug}: verified chapter is missing bilingual substantive content`);
  }
  for (const [lang, path] of [
    ["en", join(docs, "pages", `${chapter.slug}.html`)],
    ["zh", join(docs, "zh", "pages", `${chapter.slug}.html`)],
  ]) {
    assert(existsSync(path), `${lang}: missing page ${chapter.slug}`);
    if (!existsSync(path)) continue;
    const html = readFileSync(path, "utf8");
    assert(html.includes('<meta charset="UTF-8">'), `${lang}/${chapter.slug}: missing UTF-8 meta`);
    assert(html.includes(`data-page="${chapter.slug}"`), `${lang}/${chapter.slug}: wrong page identity`);
    assert(html.includes(`data-baseline="${baseline.commit}"`), `${lang}/${chapter.slug}: missing baseline`);
    assert(html.includes(`data-lang="${lang}"`), `${lang}/${chapter.slug}: wrong language identity`);
    assert(html.includes("hreflang="), `${lang}/${chapter.slug}: missing alternate language metadata`);
    assert(html.includes('class="language-switch"'), `${lang}/${chapter.slug}: missing language switch`);
    assert(html.includes("data-learning-notes"), `${lang}/${chapter.slug}: missing learning notes`);
    assert(html.includes("data-chapter-jump"), `${lang}/${chapter.slug}: missing chapter jump`);
    assert(html.includes('class="pagination"'), `${lang}/${chapter.slug}: missing pagination`);
    assert(!html.includes("<evidence"), `${lang}/${chapter.slug}: unresolved evidence tag`);
  }
  assert(zhChapter !== undefined, `${chapter.slug}: missing Chinese metadata`);
}

const evidenceIds = new Set(evidence.items.map((item) => item.id));
assert(evidenceIds.size === evidence.items.length, "duplicate evidence ids");
for (const item of evidence.items) {
  assert(/^\d+(?:-\d+)?$/.test(item.lines), `${item.id}: invalid line range`);
  assert(item.path.length > 0 && item.title.length > 0 && item.supports.length > 0, `${item.id}: incomplete Chinese evidence record`);
  assert(item.titleEn?.length > 0 && item.supportsEn?.length > 0, `${item.id}: incomplete English evidence record`);
}

const readme = readFileSync(join(root, "README.md"), "utf8");
assert(readme.indexOf("<a id=\"english\"") >= 0, "README: missing English anchor");
assert(readme.indexOf("<a id=\"中文\"") > readme.indexOf("<a id=\"english\""), "README: English must be the default first section");

const publicFiles = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "-z"], { cwd: root }).toString("utf8").split("\0").filter(Boolean);
const textExtensions = new Set(["", ".css", ".html", ".js", ".json", ".md", ".mjs", ".yml", ".yaml"]);
const forbidden = [new RegExp(["insight", "flow"].join("[ -]?"), "i"), new RegExp(["go", "claw"].join(""), "i")];
for (const relative of publicFiles) {
  if (!textExtensions.has(extname(relative))) continue;
  const path = join(root, relative);
  if (!existsSync(path)) continue;
  const text = readFileSync(path, "utf8");
  for (const pattern of forbidden) assert(!pattern.test(text), `${relative}: contains private-comparison identifier`);
}

if (errors.length > 0) {
  console.error(errors.map((error) => `- ${error}`).join("\n"));
  process.exit(1);
}
console.log(`site-check-ok localized-pages=${manifests.en.chapters.length * 2} evidence=${evidence.items.length} files=${publicFiles.length}`);
