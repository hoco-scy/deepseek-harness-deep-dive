import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(root, "docs");
const contentDir = join(root, "content");
const sourceDir = join(root, "src");
const manifests = {
  en: JSON.parse(readFileSync(join(contentDir, "chapters.en.json"), "utf8")),
  zh: JSON.parse(readFileSync(join(contentDir, "chapters.json"), "utf8")),
};
const baseline = JSON.parse(readFileSync(join(root, "research", "baseline.json"), "utf8"));
const evidenceCatalog = JSON.parse(readFileSync(join(root, "evidence", "catalog.json"), "utf8"));
const packageInventory = JSON.parse(readFileSync(join(root, "research", "package-inventory.json"), "utf8"));
const allowedStatuses = new Set(["queued", "drafting", "verified"]);

const copy = {
  en: {
    htmlLang: "en", languageName: "中文", languageLabel: "Read this chapter in Chinese",
    brand: "Harness Systems Dissection", chapterDirectory: "Chapter directory", openDirectory: "Open chapter directory",
    filter: "Filter chapters…", filterLabel: "Filter chapters", fixedBaseline: "Pinned baseline",
    verified: "verified", drafting: "in progress", chapters: "chapters", chapter: "Chapter", upstream: "Upstream",
    scope: "Scope", onThisPage: "On this page", jump: "Jump to chapter", pageNav: "Chapter pagination",
    previous: "Previous chapter", next: "Next chapter", first: "This is the first chapter", last: "This is the final chapter",
    notesTitle: "My Learning Notes", notesPrivacy: "Autosaved only in this browser. Nothing is uploaded or committed. Export Markdown whenever you want to keep a copy.",
    notesPlaceholder: "Record your understanding, questions, counterexamples, and transferable principles…",
    localDraft: "Local draft", export: "Export Markdown", clear: "Clear", chars: "characters",
    footer: "Independent research", localOnly: "learning notes stay local by default", theme: "Toggle light or dark theme",
    statuses: { queued: "Queued", drafting: "In progress", verified: "Verified" },
    evidence: "Evidence", packageCount: "packages", sourceCount: "source files", testCount: "tests",
    sourceFiles: "TS / TSX source files", testFiles: "test files", invariantPackages: "packages with invariants",
    patchBundles: "packages with bundle patches", internalDeps: "Internal dsh dependencies", noInternalDeps: "None",
    privatePackage: "private manifest", publishablePackage: "manifest is not private", bundlePatch: "bundle patch",
    manifestDescription: "Upstream manifest description", publication: "Distribution", noDescription: "No description in the upstream manifest",
    researchQueue: "Research queue", noConclusion: "This chapter has not reached a conclusion state",
    currentScope: "Current scope", placeholderIntro: "This page is part of the complete research map, but its source-level control-flow audit is not complete. It must cover all of the following before it can be marked Verified:",
    placeholderItems: ["Actual bundle and profile assembly entry points", "Public types, events, and configuration schemas", "Normal control flow and exact mutation points", "Concurrency, scope, ownership, and cleanup", "Error, cancellation, retry, and degradation branches", "Persistence, projections, and replay semantics", "Production-path tests and runtime invariants", "Benefits, costs, limitations, and open questions"],
  },
  zh: {
    htmlLang: "zh-CN", languageName: "English", languageLabel: "阅读本章英文版",
    brand: "Harness 系统拆解", chapterDirectory: "章节目录", openDirectory: "打开章节目录",
    filter: "筛选章节……", filterLabel: "筛选章节", fixedBaseline: "固定基线",
    verified: "已复核", drafting: "撰写中", chapters: "章", chapter: "第 %s 章", upstream: "上游",
    scope: "范围", onThisPage: "本页目录", jump: "跳转章节", pageNav: "章节翻页",
    previous: "上一章", next: "下一章", first: "已经是第一章", last: "已经是最后一章",
    notesTitle: "我的学习体会", notesPrivacy: "内容仅自动保存到当前浏览器，不上传、不进入仓库。你可以导出 Markdown 自行归档。",
    notesPlaceholder: "记录你的理解、疑问、反例和可迁移原则……",
    localDraft: "本地草稿", export: "导出 Markdown", clear: "清空", chars: "字符",
    footer: "独立研究", localOnly: "学习笔记默认仅保存在浏览器本地", theme: "切换明暗主题",
    statuses: { queued: "待研究", drafting: "撰写中", verified: "已复核" },
    evidence: "证据", packageCount: "包", sourceCount: "源文件", testCount: "测试",
    sourceFiles: "TS / TSX 源文件", testFiles: "测试文件", invariantPackages: "带 invariant 的包",
    patchBundles: "带 bundle patch 的包", internalDeps: "内部 dsh 依赖", noInternalDeps: "无",
    privatePackage: "private manifest", publishablePackage: "manifest 非 private", bundlePatch: "bundle patch",
    manifestDescription: "上游 manifest 描述", publication: "发布面", noDescription: "上游 manifest 未填写描述",
    researchQueue: "研究队列", noConclusion: "本章尚未进入结论状态",
    currentScope: "当前范围", placeholderIntro: "页面已经纳入全量研究地图，但尚未完成源码控制流复核。以下是升级为“已复核”之前必须覆盖的检查面：",
    placeholderItems: ["实际 bundle / profile 装配入口", "公开类型、事件与配置 schema", "正常控制流与状态突变时机", "并发、scope、所有权与 cleanup", "错误、取消、重试和降级分支", "持久化、projection 与 replay 语义", "生产路径测试与运行时不变量", "优势、代价、限制与待验证问题"],
  },
};

function fail(message) { throw new Error(message); }

function escapeHtml(value) {
  return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}

function cleanText(value) { return value.replace(/[ \t]+$/gm, "").replace(/\n*$/, "\n"); }

if (baseline.commit !== evidenceCatalog.baseline) fail("baseline mismatch between research and evidence catalog");
if (baseline.commit !== packageInventory.baseline) fail("baseline mismatch between research and package inventory");

for (const [lang, manifest] of Object.entries(manifests)) {
  const chapterIds = new Set();
  const chapterSlugs = new Set();
  for (const chapter of manifest.chapters) {
    if (chapterIds.has(chapter.id)) fail(`${lang}: duplicate chapter id: ${chapter.id}`);
    if (chapterSlugs.has(chapter.slug)) fail(`${lang}: duplicate chapter slug: ${chapter.slug}`);
    if (!allowedStatuses.has(chapter.status)) fail(`${lang}: invalid status for ${chapter.slug}: ${chapter.status}`);
    chapterIds.add(chapter.id);
    chapterSlugs.add(chapter.slug);
  }
}
const enShape = manifests.en.chapters.map(({ id, slug, status }) => ({ id, slug, status }));
const zhShape = manifests.zh.chapters.map(({ id, slug, status }) => ({ id, slug, status }));
if (JSON.stringify(enShape) !== JSON.stringify(zhShape)) fail("English and Chinese chapter manifests diverge");

const evidenceById = new Map();
for (const item of evidenceCatalog.items) {
  if (evidenceById.has(item.id)) fail(`duplicate evidence id: ${item.id}`);
  evidenceById.set(item.id, item);
}

function sourceUrl(item) {
  const [start, end = start] = item.lines.split("-");
  const fragment = start === end ? `#L${start}` : `#L${start}-L${end}`;
  return `${evidenceCatalog.repository}/blob/${evidenceCatalog.baseline}/${item.path}${fragment}`;
}

function replaceEvidence(html, usage, lang) {
  return html.replace(/<evidence\s+id="([A-Z0-9-]+)"><\/evidence>/g, (_, id) => {
    const item = evidenceById.get(id);
    if (!item) fail(`unknown evidence id: ${id}`);
    usage.set(id, (usage.get(id) || 0) + 1);
    const title = lang === "en" ? item.titleEn : item.title;
    const supports = lang === "en" ? item.supportsEn : item.supports;
    if (!title || !supports) fail(`${id}: missing ${lang} evidence text`);
    return `<a class="evidence" href="${escapeHtml(sourceUrl(item))}" title="${escapeHtml(`${title}: ${supports}`)}" aria-label="${copy[lang].evidence} ${escapeHtml(id)}">${escapeHtml(id)}</a>`;
  });
}

function renderPackageAtlas(lang) {
  const ui = copy[lang];
  const packagesByGroup = Object.groupBy(packageInventory.packages, (pkg) => pkg.group);
  const packageByName = new Map(packageInventory.packages.map(pkg => [pkg.name, pkg]));
  const summary = `<div class="atlas-summary">
    <div><strong>${packageInventory.counts.groups}</strong><span>package groups</span></div>
    <div><strong>${packageInventory.counts.packages}</strong><span>workspace packages</span></div>
    <div><strong>${packageInventory.counts.sourceFiles}</strong><span>${ui.sourceFiles}</span></div>
    <div><strong>${packageInventory.counts.testFiles}</strong><span>${ui.testFiles}</span></div>
    <div><strong>${packageInventory.counts.invariantPackages}</strong><span>${ui.invariantPackages}</span></div>
    <div><strong>${packageInventory.counts.patchBundles}</strong><span>${ui.patchBundles}</span></div>
  </div>`;
  const groups = packageInventory.groups.map((group) => {
    const rows = packagesByGroup[group.name].map((pkg) => {
      const url = `${evidenceCatalog.repository}/tree/${baseline.commit}/${pkg.path}`;
      const flags = [pkg.hasCordisPatch ? ui.bundlePatch : "", pkg.private ? ui.privatePackage : ui.publishablePackage].filter(Boolean).join(" · ");
      const dependencies = pkg.internalDependencies.length === 0
        ? `<em>${ui.noInternalDeps}</em>`
        : pkg.internalDependencies.map((name) => {
            const dependency = packageByName.get(name);
            const label = name.replace("@deepseek-ai/dsh-", "");
            if (dependency === undefined) return `<code>${escapeHtml(label)}</code>`;
            const dependencyUrl = `${evidenceCatalog.repository}/tree/${baseline.commit}/${dependency.path}`;
            return `<a href="${escapeHtml(dependencyUrl)}"><code>${escapeHtml(label)}</code></a>`;
          }).join(" ");
      return `<tr><td><a href="${escapeHtml(url)}"><code>${escapeHtml(pkg.leaf)}</code></a><small>${escapeHtml(pkg.name)}</small></td>
        <td>${escapeHtml(pkg.description || ui.noDescription)}</td><td class="dependency-list">${dependencies}</td><td>${pkg.sourceFiles}</td><td>${pkg.testFiles}</td><td><small>${escapeHtml(flags)}</small></td></tr>`;
    }).join("");
    return `<details class="package-group"><summary><strong>${escapeHtml(group.name)}</strong><span>${group.packageCount} ${ui.packageCount} · ${group.sourceFiles} ${ui.sourceCount} · ${group.testFiles} ${ui.testCount}</span></summary>
      <div class="table-scroll"><table class="package-table"><thead><tr><th>Package</th><th>${ui.manifestDescription}</th><th>${ui.internalDeps}</th><th>${ui.sourceCount}</th><th>${ui.testCount}</th><th>${ui.publication}</th></tr></thead><tbody>${rows}</tbody></table></div></details>`;
  }).join("");
  return summary + groups;
}

function replaceComponents(html, lang) { return html.replace("<package-atlas></package-atlas>", renderPackageAtlas(lang)); }

function placeholder(chapter, lang) {
  const ui = copy[lang];
  return `<section class="placeholder"><p class="eyebrow">${ui.researchQueue}</p><h2>${ui.noConclusion}</h2>
    <p><strong>${ui.currentScope}:</strong> ${escapeHtml(chapter.scope)}</p><p>${ui.placeholderIntro}</p>
    <ul class="placeholder-checks">${ui.placeholderItems.map((item) => `<li>${item}</li>`).join("")}</ul></section>`;
}

function groupChapters(chapters) {
  const groups = [];
  for (const chapter of chapters) {
    const previous = groups.at(-1);
    if (!previous || previous.part !== chapter.part) groups.push({ part: chapter.part, chapters: [chapter] });
    else previous.chapters.push(chapter);
  }
  return groups;
}

function renderSidebar(manifest, current, languageRoot, ui) {
  return groupChapters(manifest.chapters).map((group) => `<section class="nav-part" data-part><h2 class="part-title">${escapeHtml(group.part)}</h2>
    ${group.chapters.map((chapter) => `<a class="chapter-link${chapter.slug === current.slug ? " current" : ""}" data-chapter-item href="${languageRoot}pages/${chapter.slug}.html">
      <span class="chapter-number">${escapeHtml(chapter.id)}</span><span>${escapeHtml(chapter.title)}</span><span class="status-dot ${chapter.status}" title="${ui.statuses[chapter.status]}"></span></a>`).join("")}</section>`).join("");
}

function renderJump(manifest, current) {
  return manifest.chapters.map((chapter) => `<option value="${escapeHtml(chapter.slug)}"${chapter.slug === current.slug ? " selected" : ""}>${chapter.id} · ${escapeHtml(chapter.title)}</option>`).join("");
}

function renderPagination(manifest, index, languageRoot, ui) {
  const previous = manifest.chapters[index - 1];
  const next = manifest.chapters[index + 1];
  const prev = previous ? `<a href="${languageRoot}pages/${previous.slug}.html"><small>← ${ui.previous} · ${previous.id}</small><strong>${escapeHtml(previous.title)}</strong></a>`
    : `<span class="disabled"><small>← ${ui.previous}</small><strong>${ui.first}</strong></span>`;
  const nextLink = next ? `<a class="next" href="${languageRoot}pages/${next.slug}.html"><small>${ui.next} · ${next.id} →</small><strong>${escapeHtml(next.title)}</strong></a>`
    : `<span class="next disabled"><small>${ui.next} →</small><strong>${ui.last}</strong></span>`;
  return `<nav class="pagination" aria-label="${ui.pageNav}">${prev}${nextLink}</nav>`;
}

function renderNotes(ui) {
  return `<section class="learning-notes" aria-labelledby="learning-notes-title"><h2 id="learning-notes-title">${ui.notesTitle}</h2>
    <p class="privacy">${ui.notesPrivacy}</p><textarea data-learning-notes aria-label="${ui.notesTitle}" placeholder="${ui.notesPlaceholder}"></textarea>
    <div class="note-footer"><span data-note-saved>${ui.localDraft}</span><button type="button" data-note-export>${ui.export}</button>
    <button type="button" class="danger" data-note-clear>${ui.clear}</button><span data-note-count>0 ${ui.chars}</span></div></section>`;
}

function renderPage({ lang, manifest, chapter, index, content, assetRoot, languageRoot, canonicalPath, alternatePath, languageHref }) {
  const ui = copy[lang];
  const verifiedCount = manifest.chapters.filter((item) => item.status === "verified").length;
  const draftingCount = manifest.chapters.filter((item) => item.status === "drafting").length;
  const canonical = `https://hoco-scy.github.io/dpsk-harness-analysis/${canonicalPath}`;
  const alternate = `https://hoco-scy.github.io/dpsk-harness-analysis/${alternatePath}`;
  const chapterLabel = lang === "en" ? `${ui.chapter} ${chapter.id}` : ui.chapter.replace("%s", chapter.id);
  return `<!doctype html>
<html lang="${ui.htmlLang}" data-root="${languageRoot}">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><meta name="description" content="${escapeHtml(chapter.subtitle)}">
  <link rel="canonical" href="${canonical}"><link rel="alternate" hreflang="${lang === "en" ? "zh-CN" : "en"}" href="${alternate}"><link rel="alternate" hreflang="x-default" href="https://hoco-scy.github.io/dpsk-harness-analysis/${lang === "en" ? canonicalPath : alternatePath}">
  <link rel="stylesheet" href="${assetRoot}assets/site.css"><title>${escapeHtml(chapter.title)} · ${escapeHtml(manifest.title)}</title></head>
<body data-page="${escapeHtml(chapter.slug)}" data-baseline="${baseline.commit}" data-lang="${lang}">
  <header class="topbar"><button class="icon-button nav-toggle" type="button" data-nav-toggle aria-label="${ui.openDirectory}" aria-expanded="false">☰</button>
    <a class="brand" href="${languageRoot}index.html"><span class="brand-mark">DS</span><span>${ui.brand}</span></a>
    <span class="topbar-meta">${ui.fixedBaseline} ${baseline.shortCommit} · ${verifiedCount} ${ui.verified} / ${draftingCount} ${ui.drafting} / ${manifest.chapters.length} ${ui.chapters}</span>
    <div class="topbar-actions"><a class="language-switch" href="${languageHref}" lang="${lang === "en" ? "zh-CN" : "en"}" aria-label="${ui.languageLabel}">${ui.languageName}</a><button class="icon-button" type="button" data-theme-toggle aria-label="${ui.theme}">◐</button></div></header>
  <div class="layout"><aside class="sidebar" data-sidebar aria-label="${ui.chapterDirectory}"><input class="filter" data-chapter-filter type="search" placeholder="${ui.filter}" aria-label="${ui.filterLabel}">${renderSidebar(manifest, chapter, languageRoot, ui)}</aside>
    <main class="main"><div class="page-shell"><article class="article" data-article><header><div class="page-kicker"><span>${escapeHtml(chapter.part)}</span><span>·</span><span>${chapterLabel}</span></div>
      <h1>${escapeHtml(chapter.title)}</h1><p class="subtitle">${escapeHtml(chapter.subtitle)}</p><div class="page-meta"><span class="status ${chapter.status}">${ui.statuses[chapter.status]}</span><span>${ui.upstream} ${baseline.shortCommit}</span><span>${ui.scope}: ${escapeHtml(chapter.scope)}</span></div></header>
      ${content}${renderNotes(ui)}${renderPagination(manifest, index, languageRoot, ui)}</article>
      <aside class="right-rail" aria-label="${ui.onThisPage}"><h2 class="rail-title">${ui.onThisPage}</h2><nav class="toc" data-toc></nav><label class="jump-label" for="chapter-jump">${ui.jump}</label><select class="jump-select" id="chapter-jump" data-chapter-jump>${renderJump(manifest, chapter)}</select></aside></div>
      <footer class="footer">${ui.footer} · ${ui.fixedBaseline} ${baseline.commit} · ${ui.localOnly}</footer></main></div>
  <script src="${assetRoot}assets/site.js" defer></script></body></html>`;
}

rmSync(outDir, { recursive: true, force: true });
mkdirSync(join(outDir, "assets"), { recursive: true });
mkdirSync(join(outDir, "pages"), { recursive: true });
mkdirSync(join(outDir, "zh", "pages"), { recursive: true });
cpSync(join(sourceDir, "site.css"), join(outDir, "assets", "site.css"));
cpSync(join(sourceDir, "site.js"), join(outDir, "assets", "site.js"));
writeFileSync(join(outDir, ".nojekyll"), "");

const evidenceUsage = new Map();
for (const lang of ["en", "zh"]) {
  const manifest = manifests[lang];
  const searchIndex = [];
  const outputBase = lang === "en" ? outDir : join(outDir, "zh");
  for (const [index, chapter] of manifest.chapters.entries()) {
    const source = lang === "en" ? join(contentDir, "en", `${chapter.id}-${chapter.slug}.html`) : join(contentDir, `${chapter.id}-${chapter.slug}.html`);
    const raw = existsSync(source) ? readFileSync(source, "utf8") : placeholder(chapter, lang);
    const content = replaceEvidence(replaceComponents(raw, lang), evidenceUsage, lang);
    const isEnglish = lang === "en";
    const pageOutput = renderPage({ lang, manifest, chapter, index, content,
      assetRoot: isEnglish ? "../" : "../../", languageRoot: "../",
      canonicalPath: `${isEnglish ? "" : "zh/"}pages/${chapter.slug}.html`,
      alternatePath: `${isEnglish ? "zh/" : ""}pages/${chapter.slug}.html`,
      languageHref: isEnglish ? `../zh/pages/${chapter.slug}.html` : `../../pages/${chapter.slug}.html` });
    writeFileSync(join(outputBase, "pages", `${chapter.slug}.html`), cleanText(pageOutput));
    searchIndex.push({ id: chapter.id, slug: chapter.slug, part: chapter.part, title: chapter.title, subtitle: chapter.subtitle, status: chapter.status, text: raw.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim() });
    if (index === 0) {
      const indexOutput = renderPage({ lang, manifest, chapter, index, content,
        assetRoot: isEnglish ? "" : "../", languageRoot: "", canonicalPath: isEnglish ? "" : "zh/",
        alternatePath: isEnglish ? "zh/" : "", languageHref: isEnglish ? "zh/index.html" : "../index.html" });
      writeFileSync(join(outputBase, "index.html"), cleanText(indexOutput));
    }
  }
  writeFileSync(join(outDir, "assets", `chapters.${lang}.json`), JSON.stringify(searchIndex, null, 2) + "\n");
}

writeFileSync(join(outDir, "assets", "evidence.json"), JSON.stringify({ ...evidenceCatalog, usage: Object.fromEntries([...evidenceUsage].sort()) }, null, 2) + "\n");
writeFileSync(join(outDir, "404.html"), `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Page not found / 页面不存在</title><p>Page not found. <a href="/dpsk-harness-analysis/">Return to the English research site</a>.</p><p lang="zh-CN">页面不存在。<a href="/dpsk-harness-analysis/zh/">返回中文研究首页</a>。</p></html>\n`);
console.log(`built ${manifests.en.chapters.length * 2} localized chapter pages, ${evidenceUsage.size} evidence items cited`);
