import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, extname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { repositorySlug, repositoryUrl, siteUrl } from "./site-config.mjs";

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

function assertLocalReferences(path, html, label) {
  for (const match of html.matchAll(/(?:href|src)="([^"]+)"/g)) {
    const target = match[1];
    if (/^(?:https?:|mailto:|#)/.test(target)) continue;
    if (target.startsWith("/")) {
      assert(target === `/${repositorySlug}/` || target === `/${repositorySlug}/zh/`, `${label}: stale or unexpected root-relative URL ${target}`);
      continue;
    }
    const localTarget = resolve(dirname(path), decodeURIComponent(target.split("#")[0]));
    assert(existsSync(localTarget), `${label}: local reference does not resolve: ${target} -> ${relative(root, localTarget)}`);
  }
}

const markdownFiles = ["DEEPSEEK-HARNESS-ANALYSIS.md", "DEEPSEEK-HARNESS-ANALYSIS.zh-CN.md"];
for (const filename of markdownFiles) assert(existsSync(join(root, filename)), `missing generated Markdown report ${filename}`);

assert(existsSync(join(docs, "index.html")), "missing default English docs/index.html");
assert(existsSync(join(docs, "zh", "index.html")), "missing Chinese docs/zh/index.html");
for (const filename of ["social-preview-en.jpg", "social-preview-zh.jpg"]) {
  assert(existsSync(join(root, "assets", filename)), `missing source social preview assets/${filename}`);
  assert(existsSync(join(docs, "assets", filename)), `missing published social preview docs/assets/${filename}`);
}
assert(baseline.commit === evidence.baseline, "baseline mismatch");
assert(!Object.hasOwn(baseline, "sourcePath"), "research baseline must not contain a machine-local sourcePath");

for (const [label, path, canonical] of [
  ["en/index", join(docs, "index.html"), `${siteUrl}/`],
  ["zh/index", join(docs, "zh", "index.html"), `${siteUrl}/zh/`],
]) {
  const html = readFileSync(path, "utf8");
  assert(html.includes(`<link rel="canonical" href="${canonical}">`), `${label}: stale canonical URL`);
  const lang = label.startsWith("en/") ? "en" : "zh";
  assert(html.includes('<meta property="og:type" content="website">'), `${label}: missing landing-page Open Graph type`);
  assert(html.includes(`<meta property="og:image" content="${siteUrl}/assets/social-preview-${lang}.jpg">`), `${label}: wrong localized social preview`);
  assert(html.includes('<meta name="twitter:card" content="summary_large_image">'), `${label}: missing Twitter card metadata`);
  assertLocalReferences(path, html, label);
}
assertLocalReferences(join(docs, "404.html"), readFileSync(join(docs, "404.html"), "utf8"), "404");

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
    assert(html.includes('<meta property="og:type" content="article">'), `${lang}/${chapter.slug}: missing article Open Graph type`);
    assert(html.includes(`<meta property="og:image" content="${siteUrl}/assets/social-preview-${lang}.jpg">`), `${lang}/${chapter.slug}: wrong localized social preview`);
    assert(html.includes('<meta name="twitter:card" content="summary_large_image">'), `${lang}/${chapter.slug}: missing Twitter card metadata`);
    assert(html.includes('class="language-switch"'), `${lang}/${chapter.slug}: missing language switch`);
    assert(html.includes("data-learning-notes"), `${lang}/${chapter.slug}: missing learning notes`);
    assert(html.includes("data-chapter-jump"), `${lang}/${chapter.slug}: missing chapter jump`);
    assert(html.includes('class="pagination"'), `${lang}/${chapter.slug}: missing pagination`);
    const publishedPath = `${lang === "en" ? "" : "zh/"}pages/${chapter.slug}.html`;
    assert(html.includes(`<link rel="canonical" href="${siteUrl}/${publishedPath}">`), `${lang}/${chapter.slug}: stale canonical URL`);
    assertLocalReferences(path, html, `${lang}/${chapter.slug}`);
    assert(!html.includes("<evidence"), `${lang}/${chapter.slug}: unresolved evidence tag`);
    if (chapter.status === "queued") {
      assert(html.includes('<section class="placeholder">'), `${lang}/${chapter.slug}: queued draft leaked into the public build`);
    } else {
      assert(!html.includes('<section class="placeholder">'), `${lang}/${chapter.slug}: promoted chapter still renders a placeholder`);
    }
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
assert(readme.includes(`${siteUrl}/`), "README: missing current Pages URL");
assert(readme.includes("./assets/social-preview-en.jpg"), "README: missing English social preview");
assert(readme.includes("./assets/social-preview-zh.jpg"), "README: missing Chinese social preview");
assert(readme.includes("**36/36**") && readme.includes("**1,094**") && readme.includes("**533**") && readme.includes("**219**"), "README: missing verified research proof points");
const englishGuide = readFileSync(join(content, "en", "00-reading-guide.html"), "utf8");
assert(englishGuide.includes(`${repositoryUrl}/blob/main/DEEPSEEK-HARNESS-ANALYSIS.md`), "English reading guide: missing current repository URL");

const packageManifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
assert(packageManifest.name === repositorySlug, `package.json: expected name ${repositorySlug}`);

for (const filename of markdownFiles) {
  if (!existsSync(join(root, filename))) continue;
  const markdown = readFileSync(join(root, filename), "utf8");
  const englishLink = markdown.indexOf("(./DEEPSEEK-HARNESS-ANALYSIS.md)");
  const chineseLink = markdown.indexOf("(./DEEPSEEK-HARNESS-ANALYSIS.zh-CN.md)");
  assert(englishLink >= 0 && chineseLink > englishLink, `${filename}: missing English-first language switch`);
  assert(markdown.includes(baseline.commit), `${filename}: missing pinned baseline`);
  assert(!markdown.includes("<evidence"), `${filename}: unresolved evidence tag`);
}

const publicFiles = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "-z"], { cwd: root }).toString("utf8").split("\0").filter(Boolean);
const textExtensions = new Set(["", ".css", ".html", ".js", ".json", ".md", ".mjs", ".yml", ".yaml"]);
const forbidden = [
  new RegExp(["insight", "flow"].join("[ -]?"), "i"),
  new RegExp(["go", "claw"].join(""), "i"),
  new RegExp(["/home", "scy"].join("/"), "i"),
  new RegExp(["cy", "shen@"].join("_"), "i"),
  new RegExp(["next", "level", "builder"].join(""), "i"),
];
const stalePublishedUrls = [
  ["https://hoco-scy.github.io", ["dpsk", "harness", "analysis"].join("-")].join("/"),
  ["https://github.com/hoco-scy", ["dpsk", "harness", "analysis"].join("-")].join("/"),
];
for (const relative of publicFiles) {
  if (!textExtensions.has(extname(relative))) continue;
  const path = join(root, relative);
  if (!existsSync(path)) continue;
  const text = readFileSync(path, "utf8");
  for (const pattern of forbidden) assert(!pattern.test(text), `${relative}: contains private-comparison identifier`);
  for (const staleUrl of stalePublishedUrls) assert(!text.includes(staleUrl), `${relative}: contains stale published URL ${staleUrl}`);
}

if (errors.length > 0) {
  console.error(errors.map((error) => `- ${error}`).join("\n"));
  process.exit(1);
}
console.log(`site-check-ok localized-pages=${manifests.en.chapters.length * 2} evidence=${evidence.items.length} files=${publicFiles.length}`);
