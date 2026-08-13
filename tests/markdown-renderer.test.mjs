import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { buildMarkdown } from "../scripts/build-markdown.mjs";
import {
  anchorIdSequence,
  evidenceSequence,
  externalHrefSequence,
  hrefSequence,
  parseFragment,
  semanticFingerprint,
} from "../scripts/fragment-parser.mjs";
import { renderReports } from "../scripts/markdown-renderer.mjs";
import { assertBilingualChapterParity, buildReportModel } from "../scripts/report-model.mjs";

const COMMIT = "a".repeat(40);
const TEST_REPOSITORY_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function resolveLiveChapter35Repository() {
  const explicitRoot = process.env.MARKDOWN_CH35_REPO === undefined ? undefined : resolve(process.env.MARKDOWN_CH35_REPO);
  const explicitUpstream = process.env.MARKDOWN_UPSTREAM_ROOT === undefined ? undefined : resolve(process.env.MARKDOWN_UPSTREAM_ROOT);
  const candidates = [...new Set([explicitRoot, process.cwd(), TEST_REPOSITORY_ROOT].filter(Boolean).map((candidate) => resolve(candidate)))];
  for (const candidate of candidates) {
    const root = candidate;
    const manifestPath = join(root, "content", "chapters.en.json");
    if (!existsSync(manifestPath)) continue;
    try {
      const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
      const chapter = manifest.chapters.find((record) => record.id === "35");
      if (chapter?.status === "queued") continue;
      if (!chapter || !existsSync(join(root, "content", "en", `35-${chapter.slug}.html`))) continue;
      if (!existsSync(join(root, "content", `35-${chapter.slug}.html`))) continue;
      const upstreamRoot = explicitUpstream ?? resolve(root, "..", "deepseek-harness");
      if (root !== explicitRoot && !existsSync(upstreamRoot)) continue;
      return { repoRoot: root, upstreamRoot };
    } catch {
      // A malformed candidate is not a usable live fixture; the model tests validate it separately.
    }
  }
  return undefined;
}

const LIVE_CHAPTER_35_REPOSITORY = resolveLiveChapter35Repository();

const EN_FRAGMENT = `<section id="syntax">
  <h2>Syntax fidelity</h2>
  <p>Inline <code>a\`b</code>, <strong>bold <em>nested</em></strong>, <a href="https://example.test/docs?x=1&amp;y=2">docs</a>, and <evidence id="E-ONE"></evidence>.</p>
  <pre><code>└─ root &lt; child
literal \`\`\` run
preserve${"  "}


after two blank lines</code></pre>
  <div class="table-scroll"><table>
    <thead><tr><th>Key</th><th>Value</th></tr></thead>
    <tbody><tr><td>pipe</td><td>A | B
C</td></tr></tbody>
  </table></div>
  <div class="table-scroll"><table>
    <thead><tr><th colspan="2">Spanned heading</th></tr></thead>
    <tbody><tr><td rowspan="2">left</td><td>right 1</td></tr><tr><td>right 2</td></tr></tbody>
  </table></div>
  <div class="table-scroll"><table>
    <thead><tr><th>Term</th><th>Definition</th><th>Navigation</th></tr></thead>
    <tbody><tr><td><strong id="term-fixture">Fixture</strong><br><code>fixture</code></td><td><p>Definition.</p><small>Alias: sample</small></td><td><a href="#evidence-E-ONE"><code id="evidence-E-ONE">E-ONE</code></a></td></tr></tbody>
  </table></div>
  <details class="index-group" open><summary>Generated index</summary><p>Expanded in Markdown.</p></details>
  <package-atlas></package-atlas>
</section>`;

const ZH_FRAGMENT = `<section id="syntax">
  <h2>语法保真</h2>
  <p>行内 <code>a\`b</code>、<strong>粗体 <em>嵌套</em></strong>、<a href="https://example.test/docs?x=1&amp;y=2">文档</a>与<evidence id="E-ONE"></evidence>。</p>
  <pre><code>└─ 根 &lt; 子节点
literal \`\`\` run</code></pre>
  <div class="table-scroll"><table>
    <thead><tr><th>键</th><th>值</th></tr></thead>
    <tbody><tr><td>管道</td><td>A | B
C</td></tr></tbody>
  </table></div>
  <div class="table-scroll"><table>
    <thead><tr><th colspan="2">跨列标题</th></tr></thead>
    <tbody><tr><td rowspan="2">左</td><td>右一</td></tr><tr><td>右二</td></tr></tbody>
  </table></div>
  <div class="table-scroll"><table>
    <thead><tr><th>术语</th><th>定义</th><th>导航</th></tr></thead>
    <tbody><tr><td><strong id="term-fixture">夹具</strong><br><code>fixture</code></td><td><p>定义。</p><small>别名：样例</small></td><td><a href="#evidence-E-ONE"><code id="evidence-E-ONE">E-ONE</code></a></td></tr></tbody>
  </table></div>
  <details class="index-group" open><summary>生成索引</summary><p>在 Markdown 中展开。</p></details>
  <package-atlas></package-atlas>
</section>`;

function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function createFixtureRepository(options = {}) {
  const root = join(tmpdir(), `markdown-production-${process.pid}-${Math.random().toString(16).slice(2)}`);
  mkdirSync(join(root, "content", "en"), { recursive: true });
  mkdirSync(join(root, "evidence"), { recursive: true });
  mkdirSync(join(root, "research"), { recursive: true });
  const status = options.status ?? "verified";
  const chapter = { id: "00", slug: "syntax", part: "Part", title: "Syntax", subtitle: "Subtitle", status, scope: "Scope" };
  const chapterZh = { ...chapter, part: "分部", title: "语法", subtitle: "副标题", scope: "范围" };
  writeJson(join(root, "content", "chapters.en.json"), { title: "Report", description: "Description", chapters: [chapter] });
  writeJson(join(root, "content", "chapters.json"), { title: "报告", description: "描述", chapters: [chapterZh] });
  if (options.englishSource !== null) writeFileSync(join(root, "content", "en", "00-syntax.html"), options.englishSource ?? EN_FRAGMENT, "utf8");
  if (options.chineseSource !== null) writeFileSync(join(root, "content", "00-syntax.html"), options.chineseSource ?? ZH_FRAGMENT, "utf8");
  writeJson(join(root, "research", "baseline.json"), {
    project: "Fixture", repository: "https://example.test/repository", commit: COMMIT, shortCommit: COMMIT.slice(0, 10),
  });
  writeJson(join(root, "evidence", "catalog.json"), {
    baseline: COMMIT,
    repository: "https://example.test/repository",
    items: [{ id: "E-ONE", kind: "test", path: "dir with space/source.ts", lines: "1-2", title: "证据", supports: "支持", titleEn: "Evidence", supportsEn: "Supports" }],
  });
  writeJson(join(root, "research", "package-inventory.json"), {
    baseline: COMMIT,
    generatedBy: "fixture",
    counts: { groups: 1, packages: 1, sourceFiles: 2, testFiles: 1, invariantPackages: 1, patchBundles: 0 },
    groups: [{ name: "core", packageCount: 1, sourceFiles: 2, testFiles: 1 }],
    packages: [{ group: "core", leaf: "runtime", name: "@example/runtime", description: "Runtime | package", path: "packages/core/runtime", private: false, internalDependencies: [], sourceFiles: 2, testFiles: 1, hasInvariant: true, hasReadme: true, hasCordisPatch: false, dsh: null }],
  });
  return root;
}

function projection(source) {
  const ast = parseFragment(source, "fixture");
  return {
    chapter: { id: "00", slug: "fixture" },
    evidenceIds: evidenceSequence(ast),
    externalHrefs: externalHrefSequence(ast, "fixture"),
    normalizedHrefs: hrefSequence(ast, "fixture"),
    anchorIds: anchorIdSequence(ast),
    fingerprint: semanticFingerprint(ast),
  };
}

test("renders code, entities, links, evidence, tables, details, and inventory deterministically", (context) => {
  const root = createFixtureRepository();
  context.after(() => rmSync(root, { recursive: true, force: true }));
  const model = buildReportModel({ repoRoot: root, sourceCheck: "off" });
  const first = renderReports(model);
  const second = renderReports(buildReportModel({ repoRoot: root, sourceCheck: "off" }));
  assert.equal(first.en.markdown, second.en.markdown);
  assert.match(first.en.markdown, /``a`b``/);
  assert.match(first.en.markdown, /````\n└─ root < child\nliteral ``` run\npreserve  \n\n\nafter two blank lines\n````/);
  assert.match(first.en.markdown, /A \\`?\| B<br>C/);
  assert.match(first.en.markdown, /<th colspan="2">Spanned heading<\/th>/);
  assert.match(first.en.markdown, /<td rowspan="2">left<\/td>/);
  assert.match(first.en.markdown, /<strong id="term-fixture">Fixture<\/strong><br>/);
  assert.match(first.en.markdown, /href="#evidence-E-ONE"><code id="evidence-E-ONE">E-ONE<\/code>/);
  assert.match(first.en.markdown, /<small>Alias: sample<\/small>/);
  assert.match(first.en.markdown, /\[docs\]\(https:\/\/example\.test\/docs\?x=1&y=2\)/);
  assert.match(first.en.markdown, new RegExp(`https://example\\.test/repository/blob/${COMMIT}/dir%20with%20space/source\\.ts#L1-L2`));
  assert.match(first.en.markdown, /<a id="syntax"><\/a>/);
  assert.match(first.en.markdown, /\*\*Generated index\*\*\n\nExpanded in Markdown\./);
  assert.doesNotMatch(first.en.markdown, /<details|<summary/);
  assert.match(first.en.markdown, new RegExp(`https://example\\.test/repository/tree/${COMMIT}/packages/core/runtime`));
  assert.equal(first.en.evidenceIds.join(","), "E-ONE");
  assert.deepEqual(first.en.evidenceIds, first.zh.evidenceIds);
});

test("queued source is never parsed or leaked, even when a draft file exists", (context) => {
  const poison = `${["insight", "flow"].join(" ")} <future-component>not public</future-component>`;
  const root = createFixtureRepository({ status: "queued", englishSource: poison, chineseSource: poison });
  const out = join(root, "out");
  context.after(() => rmSync(root, { recursive: true, force: true }));
  const summary = buildMarkdown({ repoRoot: root, outDir: out, check: false, sourceCheck: "off" });
  assert.equal(summary.chapters, 1);
  const english = readFileSync(join(out, "DEEPSEEK-HARNESS-ANALYSIS.md"), "utf8");
  assert.doesNotMatch(english, /future-component|not public/i);
  assert.match(english, /remains queued/);
});

test("drafting and verified chapters require both language sources", (context) => {
  const root = createFixtureRepository({ status: "drafting", chineseSource: null });
  context.after(() => rmSync(root, { recursive: true, force: true }));
  assert.throws(() => buildReportModel({ repoRoot: root, sourceCheck: "off" }), /drafting chapter is missing its source fragment/);
});

test("optional source validation reports an unavailable checkout instead of claiming success", (context) => {
  const root = createFixtureRepository();
  context.after(() => rmSync(root, { recursive: true, force: true }));
  const upstreamRoot = join(root, "missing-upstream");
  const model = buildReportModel({ repoRoot: root, upstreamRoot, sourceCheck: "auto" });
  assert.deepEqual(model.sourceValidation, { performed: false, reason: "checkout-unavailable" });
  assert.throws(() => buildReportModel({ repoRoot: root, upstreamRoot, sourceCheck: "required" }), /pinned source checkout is unavailable/);
});

test("strict parser rejects unknown or structurally unsafe fragment syntax", () => {
  assert.throws(() => parseFragment("<section><future-component></future-component></section>"), /unsupported tag/);
  assert.throws(() => parseFragment("<section onclick=\"x\"><h2>H</h2></section>"), /does not allow attribute onclick/);
  assert.throws(() => parseFragment("<section><p>&copy;</p></section>"), /unsupported entity/);
  assert.throws(() => parseFragment("<section><details class=\"index-group\"><p>missing summary</p></details></section>"), /must start with exactly one <summary>/);
  assert.throws(() => parseFragment("<section><pre><code>x</code><code>y</code></pre></section>"), /exactly one <code>/);
});

test("bilingual parity rejects every protected structural mutation class", async (context) => {
  const base = `<section id="alpha"><h2>Top</h2><h3>Sub</h3><div class="claim fact"><div class="claim-label">Fact</div><p>Body</p></div><ul><li>A</li><li>B</li></ul><div class="table-scroll"><table><thead><tr><th>A</th><th>B</th></tr></thead><tbody><tr><td>1</td><td>2</td></tr></tbody></table></div><details class="index-group" open><summary>Index</summary><p>Body</p></details><p><a href="https://example.test/a">Link</a><evidence id="E-ONE"></evidence></p><package-atlas></package-atlas></section>`;
  const mutations = new Map([
    ["section order/count", `${base}<section id="beta"><h2>Second</h2></section>`],
    ["heading sequence", base.replace("<h3>Sub</h3>", "<h2>Sub</h2>")],
    ["table dimensions", base.replace("<th>A</th><th>B</th>", "<th>A</th><th>B</th><th>C</th>").replace("<td>1</td><td>2</td>", "<td>1</td><td>2</td><td>3</td>")],
    ["list cardinality", base.replace("<li>B</li>", "")],
    ["list type", base.replace("<ul><li>A</li><li>B</li></ul>", "<ol><li>A</li><li>B</li></ol>")],
    ["claim kind/order", base.replace("claim fact", "claim assessment")],
    ["evidence occurrence", base.replace("E-ONE", "E-TWO")],
    ["package-atlas count", base.replace("<package-atlas></package-atlas>", "")],
    ["details structure", base.replace("<details class=\"index-group\" open><summary>Index</summary><p>Body</p></details>", "<p>Body</p>")],
    ["anchor ID sequence", base.replace("id=\"alpha\"", "id=\"beta\"")],
    ["external href target", base.replace("https://example.test/a", "https://example.test/b")],
  ]);
  for (const [name, mutation] of mutations) {
    await context.test(name, () => {
      assert.throws(() => assertBilingualChapterParity(projection(base), projection(mutation)), /bilingual/);
    });
  }
});

test("build --check is a byte comparison and detects stale output", (context) => {
  const root = createFixtureRepository();
  const out = join(root, "out");
  context.after(() => rmSync(root, { recursive: true, force: true }));
  buildMarkdown({ repoRoot: root, outDir: out, check: false, sourceCheck: "off" });
  assert.doesNotThrow(() => buildMarkdown({ repoRoot: root, outDir: out, check: true, sourceCheck: "off" }));
  const path = join(out, "DEEPSEEK-HARNESS-ANALYSIS.md");
  writeFileSync(path, `${readFileSync(path, "utf8")}stale\n`, "utf8");
  assert.throws(() => buildMarkdown({ repoRoot: root, outDir: out, check: true, sourceCheck: "off" }), /differs from generated bytes/);
});

test("public-safety scan rejects forbidden identifiers in promoted content", (context) => {
  const forbidden = ["go", "claw"].join("");
  const source = EN_FRAGMENT.replace("Syntax fidelity", forbidden);
  const sourceZh = ZH_FRAGMENT.replace("语法保真", forbidden);
  const root = createFixtureRepository({ englishSource: source, chineseSource: sourceZh });
  context.after(() => rmSync(root, { recursive: true, force: true }));
  assert.throws(() => buildMarkdown({ repoRoot: root, outDir: join(root, "out"), check: false, sourceCheck: "off" }), /forbidden private-comparison identifier/);
});

test("optional live Chapter 35 fixture preserves every generated anchor and unfolds details", {
  skip: LIVE_CHAPTER_35_REPOSITORY === undefined,
}, () => {
  const model = buildReportModel({ ...LIVE_CHAPTER_35_REPOSITORY, sourceCheck: "required" });
  const englishChapter = model.languages.en.chapters.find((record) => record.chapter.id === "35");
  const chineseChapter = model.languages.zh.chapters.find((record) => record.chapter.id === "35");
  assert.equal(englishChapter.chapter.status, "verified");
  assert.deepEqual(englishChapter.anchorIds, chineseChapter.anchorIds);
  assert.ok(englishChapter.anchorIds.length > 0);
  const rendered = renderReports(model);
  for (const id of englishChapter.anchorIds) assert.match(rendered.en.markdown, new RegExp(`\\bid="${id}"`));
  assert.doesNotMatch(rendered.en.markdown, /<details|<summary/);
  assert.match(rendered.en.markdown, /href="#evidence-[A-Z0-9-]+"/);
});
