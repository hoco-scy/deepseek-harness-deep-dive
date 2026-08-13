import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(root, "docs");
const contentDir = join(root, "content");
const sourceDir = join(root, "src");
const manifest = JSON.parse(readFileSync(join(contentDir, "chapters.json"), "utf8"));
const baseline = JSON.parse(readFileSync(join(root, "research", "baseline.json"), "utf8"));
const evidenceCatalog = JSON.parse(readFileSync(join(root, "evidence", "catalog.json"), "utf8"));
const packageInventory = JSON.parse(readFileSync(join(root, "research", "package-inventory.json"), "utf8"));
const allowedStatuses = new Set(["queued", "drafting", "verified"]);
const statusLabels = { queued: "待研究", drafting: "撰写中", verified: "已复核" };

function fail(message) {
  throw new Error(message);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function cleanText(value) {
  return value.replace(/[ \t]+$/gm, "").replace(/\n*$/, "\n");
}

if (baseline.commit !== evidenceCatalog.baseline) fail("baseline mismatch between research and evidence catalog");
if (baseline.commit !== packageInventory.baseline) fail("baseline mismatch between research and package inventory");

const chapterIds = new Set();
const chapterSlugs = new Set();
for (const chapter of manifest.chapters) {
  if (chapterIds.has(chapter.id)) fail(`duplicate chapter id: ${chapter.id}`);
  if (chapterSlugs.has(chapter.slug)) fail(`duplicate chapter slug: ${chapter.slug}`);
  if (!allowedStatuses.has(chapter.status)) fail(`invalid status for ${chapter.slug}: ${chapter.status}`);
  chapterIds.add(chapter.id);
  chapterSlugs.add(chapter.slug);
}

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

function replaceEvidence(html, usage) {
  return html.replace(/<evidence\s+id="([A-Z0-9-]+)"><\/evidence>/g, (_, id) => {
    const item = evidenceById.get(id);
    if (!item) fail(`unknown evidence id: ${id}`);
    usage.set(id, (usage.get(id) || 0) + 1);
    return `<a class="evidence" href="${escapeHtml(sourceUrl(item))}" title="${escapeHtml(`${item.title}：${item.supports}`)}" aria-label="证据 ${escapeHtml(id)}">${escapeHtml(id)}</a>`;
  });
}

function renderPackageAtlas() {
  const packagesByGroup = Object.groupBy(packageInventory.packages, (pkg) => pkg.group);
  const summary = `<div class="atlas-summary">
    <div><strong>${packageInventory.counts.groups}</strong><span>package groups</span></div>
    <div><strong>${packageInventory.counts.packages}</strong><span>workspace packages</span></div>
    <div><strong>${packageInventory.counts.sourceFiles}</strong><span>TS / TSX 源文件</span></div>
    <div><strong>${packageInventory.counts.testFiles}</strong><span>测试文件</span></div>
    <div><strong>${packageInventory.counts.invariantPackages}</strong><span>带 invariant 的包</span></div>
  </div>`;
  const groups = packageInventory.groups.map((group) => {
    const packages = packagesByGroup[group.name];
    const rows = packages.map((pkg) => {
      const url = `${evidenceCatalog.repository}/tree/${baseline.commit}/${pkg.path}`;
      const flags = [
        pkg.hasCordisPatch ? "bundle patch" : "",
        pkg.private ? "private" : "published"
      ].filter(Boolean).join(" · ");
      return `<tr>
        <td><a href="${escapeHtml(url)}"><code>${escapeHtml(pkg.leaf)}</code></a><small>${escapeHtml(pkg.name)}</small></td>
        <td>${escapeHtml(pkg.description || "上游 manifest 未填写描述")}</td>
        <td>${pkg.sourceFiles}</td>
        <td>${pkg.testFiles}</td>
        <td><small>${escapeHtml(flags)}</small></td>
      </tr>`;
    }).join("");
    return `<details class="package-group">
      <summary><strong>${escapeHtml(group.name)}</strong><span>${group.packageCount} 包 · ${group.sourceFiles} 源文件 · ${group.testFiles} 测试</span></summary>
      <div class="table-scroll"><table class="package-table">
        <thead><tr><th>Package</th><th>上游 manifest 描述</th><th>源文件</th><th>测试</th><th>发布面</th></tr></thead>
        <tbody>${rows}</tbody>
      </table></div>
    </details>`;
  }).join("");
  return summary + groups;
}

function replaceComponents(html) {
  return html.replace("<package-atlas></package-atlas>", renderPackageAtlas());
}

function placeholder(chapter) {
  return `
    <section class="placeholder">
      <p class="eyebrow">研究队列</p>
      <h2>本章尚未进入结论状态</h2>
      <p><strong>当前范围：</strong>${escapeHtml(chapter.scope)}</p>
      <p>页面已经纳入全量研究地图，但尚未完成源码控制流复核。以下是升级为“已复核”之前必须覆盖的检查面：</p>
      <ul class="placeholder-checks">
        <li>实际 bundle / profile 装配入口</li>
        <li>公开类型、事件与配置 schema</li>
        <li>正常控制流与状态突变时机</li>
        <li>并发、scope、所有权与 cleanup</li>
        <li>错误、取消、重试和降级分支</li>
        <li>持久化、projection 与 replay 语义</li>
        <li>生产路径测试与运行时不变量</li>
        <li>优势、代价、限制与待验证问题</li>
      </ul>
    </section>`;
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

function renderSidebar(current, pageRoot) {
  return groupChapters(manifest.chapters).map((group) => `
    <section class="nav-part" data-part>
      <h2 class="part-title">${escapeHtml(group.part)}</h2>
      ${group.chapters.map((chapter) => `
        <a class="chapter-link${chapter.slug === current.slug ? " current" : ""}" data-chapter-item href="${pageRoot}pages/${chapter.slug}.html">
          <span class="chapter-number">${escapeHtml(chapter.id)}</span>
          <span>${escapeHtml(chapter.title)}</span>
          <span class="status-dot ${escapeHtml(chapter.status)}" title="${statusLabels[chapter.status]}"></span>
        </a>`).join("")}
    </section>`).join("");
}

function renderJump(current) {
  return manifest.chapters.map((chapter) => `<option value="${escapeHtml(chapter.slug)}"${chapter.slug === current.slug ? " selected" : ""}>${escapeHtml(chapter.id)} · ${escapeHtml(chapter.title)}</option>`).join("");
}

function renderPagination(index, pageRoot) {
  const previous = manifest.chapters[index - 1];
  const next = manifest.chapters[index + 1];
  const prev = previous
    ? `<a href="${pageRoot}pages/${previous.slug}.html"><small>← 上一章 · ${previous.id}</small><strong>${escapeHtml(previous.title)}</strong></a>`
    : `<span class="disabled"><small>← 上一章</small><strong>已经是第一章</strong></span>`;
  const nextLink = next
    ? `<a class="next" href="${pageRoot}pages/${next.slug}.html"><small>下一章 · ${next.id} →</small><strong>${escapeHtml(next.title)}</strong></a>`
    : `<span class="next disabled"><small>下一章 →</small><strong>已经是最后一章</strong></span>`;
  return `<nav class="pagination" aria-label="章节翻页">${prev}${nextLink}</nav>`;
}

function renderNotes() {
  return `
    <section class="learning-notes" aria-labelledby="learning-notes-title">
      <h2 id="learning-notes-title">我的学习体会</h2>
      <p class="privacy">内容仅自动保存到当前浏览器，不上传、不进入仓库。你可以导出 Markdown 自行归档。</p>
      <textarea data-learning-notes aria-label="我的学习体会" placeholder="记录你的理解、疑问、反例和可迁移原则……"></textarea>
      <div class="note-footer">
        <span data-note-saved>本地草稿</span>
        <button type="button" data-note-export>导出 Markdown</button>
        <button type="button" class="danger" data-note-clear>清空</button>
        <span data-note-count>0 字符</span>
      </div>
    </section>`;
}

function renderPage(chapter, index, content, pageRoot, canonicalPath) {
  const verifiedCount = manifest.chapters.filter((item) => item.status === "verified").length;
  const draftingCount = manifest.chapters.filter((item) => item.status === "drafting").length;
  const canonical = `https://hoco-scy.github.io/dpsk-harness-analysis/${canonicalPath}`;
  return `<!doctype html>
<html lang="zh-CN" data-root="${pageRoot}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="description" content="${escapeHtml(chapter.subtitle)}">
  <link rel="canonical" href="${canonical}">
  <link rel="stylesheet" href="${pageRoot}assets/site.css">
  <title>${escapeHtml(chapter.title)} · ${escapeHtml(manifest.title)}</title>
</head>
<body data-page="${escapeHtml(chapter.slug)}" data-baseline="${baseline.commit}">
  <header class="topbar">
    <button class="icon-button nav-toggle" type="button" data-nav-toggle aria-label="打开章节目录" aria-expanded="false">☰</button>
    <a class="brand" href="${pageRoot}index.html"><span class="brand-mark">DS</span><span>Harness 系统拆解</span></a>
    <span class="topbar-meta">固定基线 ${baseline.shortCommit} · ${verifiedCount} 已复核 / ${draftingCount} 撰写中 / ${manifest.chapters.length} 章</span>
    <div class="topbar-actions"><button class="icon-button" type="button" data-theme-toggle aria-label="切换明暗主题">◐</button></div>
  </header>
  <div class="layout">
    <aside class="sidebar" data-sidebar aria-label="章节目录">
      <input class="filter" data-chapter-filter type="search" placeholder="筛选章节……" aria-label="筛选章节">
      ${renderSidebar(chapter, pageRoot)}
    </aside>
    <main class="main">
      <div class="page-shell">
        <article class="article" data-article>
          <header>
            <div class="page-kicker"><span>${escapeHtml(chapter.part)}</span><span>·</span><span>第 ${escapeHtml(chapter.id)} 章</span></div>
            <h1>${escapeHtml(chapter.title)}</h1>
            <p class="subtitle">${escapeHtml(chapter.subtitle)}</p>
            <div class="page-meta">
              <span class="status ${escapeHtml(chapter.status)}">${statusLabels[chapter.status]}</span>
              <span>上游 ${baseline.shortCommit}</span>
              <span>范围：${escapeHtml(chapter.scope)}</span>
            </div>
          </header>
          ${content}
          ${renderNotes()}
          ${renderPagination(index, pageRoot)}
        </article>
        <aside class="right-rail" aria-label="页内导航">
          <h2 class="rail-title">本页目录</h2>
          <nav class="toc" data-toc></nav>
          <label class="jump-label" for="chapter-jump">跳转章节</label>
          <select class="jump-select" id="chapter-jump" data-chapter-jump>${renderJump(chapter)}</select>
        </aside>
      </div>
      <footer class="footer">独立研究 · 固定源码基线 ${baseline.commit} · 学习笔记默认仅保存在浏览器本地</footer>
    </main>
  </div>
  <script src="${pageRoot}assets/site.js" defer></script>
</body>
</html>`;
}

rmSync(outDir, { recursive: true, force: true });
mkdirSync(join(outDir, "assets"), { recursive: true });
mkdirSync(join(outDir, "pages"), { recursive: true });
cpSync(join(sourceDir, "site.css"), join(outDir, "assets", "site.css"));
cpSync(join(sourceDir, "site.js"), join(outDir, "assets", "site.js"));
writeFileSync(join(outDir, ".nojekyll"), "");

const evidenceUsage = new Map();
const searchIndex = [];
for (const [index, chapter] of manifest.chapters.entries()) {
  const source = join(contentDir, `${chapter.id}-${chapter.slug}.html`);
  const raw = existsSync(source) ? readFileSync(source, "utf8") : placeholder(chapter);
  const content = replaceEvidence(replaceComponents(raw), evidenceUsage);
  const output = renderPage(chapter, index, content, "../", `pages/${chapter.slug}.html`);
  writeFileSync(join(outDir, "pages", `${chapter.slug}.html`), cleanText(output));
  searchIndex.push({
    id: chapter.id,
    slug: chapter.slug,
    part: chapter.part,
    title: chapter.title,
    subtitle: chapter.subtitle,
    status: chapter.status,
    text: raw.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim()
  });
  if (index === 0) writeFileSync(join(outDir, "index.html"), cleanText(renderPage(chapter, index, content, "", "")));
}

writeFileSync(join(outDir, "assets", "chapters.json"), JSON.stringify(searchIndex, null, 2) + "\n");
writeFileSync(join(outDir, "assets", "evidence.json"), JSON.stringify({ ...evidenceCatalog, usage: Object.fromEntries([...evidenceUsage].sort()) }, null, 2) + "\n");
writeFileSync(join(outDir, "404.html"), `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>页面不存在</title><p>页面不存在。<a href="/dpsk-harness-analysis/">返回研究首页</a></p>\n`);

console.log(`built ${manifest.chapters.length} chapter pages, ${evidenceUsage.size} evidence items cited`);
