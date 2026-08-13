import { decodeEntities, fragmentText } from "./fragment-parser.mjs";

const OUTPUT_FILES = {
  en: "DEEPSEEK-HARNESS-ANALYSIS.md",
  zh: "DEEPSEEK-HARNESS-ANALYSIS.zh-CN.md",
};

const COPY = {
  en: {
    defaultLanguage: "English (default)", otherLanguage: "简体中文", contents: "Contents", baseline: "Pinned baseline",
    status: "Status", scope: "Scope", thesis: "Thesis", queuedBody: "This chapter remains queued. Its scope is recorded, but no substantive conclusion is published here yet.",
    statuses: { queued: "Queued", drafting: "In progress", verified: "Verified" }, packageAtlas: "Package atlas",
    groups: "groups", packages: "workspace packages", sourceFiles: "source files", testFiles: "test files",
    invariantPackages: "packages with invariants", patchBundles: "packages with bundle patches", package: "Package",
    description: "Description", dependencies: "Internal dependencies", distribution: "Distribution", none: "None",
    noDescription: "No description in the upstream manifest", private: "private manifest", publishable: "manifest is not private",
    bundlePatch: "bundle patch",
  },
  zh: {
    defaultLanguage: "English（默认）", otherLanguage: "简体中文", contents: "目录", baseline: "固定基线",
    status: "状态", scope: "范围", thesis: "核心论点", queuedBody: "本章仍在研究队列中；范围已经记录，但这里尚未发布实质结论。",
    statuses: { queued: "待研究", drafting: "撰写中", verified: "已复核" }, packageAtlas: "Package 索引",
    groups: "个 package group", packages: "个 workspace package", sourceFiles: "个源文件", testFiles: "个测试文件",
    invariantPackages: "个带 invariant 的 package", patchBundles: "个带 bundle patch 的 package", package: "Package",
    description: "描述", dependencies: "内部依赖", distribution: "发布面", none: "无",
    noDescription: "上游 manifest 未填写描述", private: "private manifest", publishable: "manifest 非 private",
    bundlePatch: "bundle patch",
  },
};

function fail(message) {
  throw new Error(message);
}

function assert(condition, message) {
  if (!condition) fail(message);
}

function classes(node) {
  return new Set((node.attrs.class ?? "").split(" ").filter(Boolean));
}

function hasClass(node, name) {
  return classes(node).has(name);
}

function elementChildren(node, tag) {
  return node.children.filter((child) => child.type === "element" && (tag === undefined || child.tag === tag));
}

function meaningfulChildren(node) {
  return node.children.filter((child) => child.type === "element" || child.value.trim().length > 0);
}

function escapeMarkdownText(value, inTable = false) {
  let output = inTable
    ? value.replace(/[\t\f\v ]+/g, " ")
    : value.replace(/\s+/g, " ");
  output = output.replaceAll("\\", "\\\\").replace(/([`*_\[\]<>])/g, "\\$1");
  if (inTable) output = output.replaceAll("|", "\\|").replace(/\n+/g, "<br>");
  return output;
}

function escapeMarkdownLabel(value) {
  return value.replaceAll("\\", "\\\\").replaceAll("[", "\\[").replaceAll("]", "\\]");
}

function inlineCode(value) {
  const text = value.replace(/\s+/g, " ");
  const runs = [...text.matchAll(/`+/g)].map((match) => match[0].length);
  const delimiter = "`".repeat(Math.max(1, ...runs.map((length) => length + 1)));
  const padding = /^`|`$|^ | $/.test(text) ? " " : "";
  return `${delimiter}${padding}${text}${padding}${delimiter}`;
}

function encodeHref(value) {
  return encodeURI(value).replaceAll("(", "%28").replaceAll(")", "%29").replaceAll(" ", "%20");
}

function rewriteHref(rawHref, context) {
  const href = decodeEntities(rawHref, context.label);
  if (/^(?:https?:|mailto:|#)/.test(href)) return encodeHref(href);
  const match = /^(?:(?:\.\.\/)*pages\/)?([a-z0-9-]+)\.html(?:#.*)?$/.exec(href);
  assert(match !== null, `${context.label}: unsupported relative href ${href}`);
  const chapter = context.model.languages[context.lang].manifest.chapters.find((item) => item.slug === match[1]);
  assert(chapter !== undefined, `${context.label}: unknown internal chapter href ${href}`);
  return `#chapter-${chapter.id}-${chapter.slug}`;
}

function encodeRepositoryPath(path) {
  return path.split("/").map((segment) => encodeURIComponent(segment)).join("/");
}

function sourceUrl(item, context) {
  const { repository, baseline } = context.model.catalog;
  const { start, end } = item.lineRange;
  const fragment = start === end ? `#L${start}` : `#L${start}-L${end}`;
  return `${repository}/blob/${baseline}/${encodeRepositoryPath(item.path)}${fragment}`;
}

function evidenceMarkdown(node, context) {
  const item = context.model.evidenceById.get(node.attrs.id);
  assert(item !== undefined, `${context.label}: unknown evidence id ${node.attrs.id}`);
  const title = context.lang === "en" ? item.titleEn : item.title;
  const support = context.lang === "en" ? item.supportsEn : item.supports;
  const tooltip = `${title}: ${support}`.replace(/\s+/g, " ").replaceAll("\\", "\\\\").replaceAll('"', "\\\"");
  context.renderedEvidence.push(node.attrs.id);
  return `[\`${node.attrs.id}\`](${sourceUrl(item, context)} "${tooltip}")`;
}

function anchorPrefix(node, context) {
  if (node.attrs.id === undefined) return "";
  context.renderedAnchors.push(node.attrs.id);
  return `<span id="${node.attrs.id}"></span>`;
}

function inline(nodes, context, inTable = false) {
  let output = "";
  for (const node of nodes) {
    if (node.type === "text") {
      output += escapeMarkdownText(decodeEntities(node.value, context.label), inTable);
      continue;
    }
    switch (node.tag) {
      case "code": output += `${anchorPrefix(node, context)}${inlineCode(fragmentText(node, context.label))}`; break;
      case "strong": output += `${anchorPrefix(node, context)}**${inline(node.children, context, inTable).trim()}**`; break;
      case "em": output += `*${inline(node.children, context, inTable).trim()}*`; break;
      case "small": output += inline(node.children, context, inTable); break;
      case "br": output += "<br>"; break;
      case "span": output += inline(node.children, context, inTable); break;
      case "a": {
        const href = rewriteHref(node.attrs.href, context);
        context.renderedHrefs.push(href);
        output += `[${inline(node.children, context, inTable).trim()}](${href})`;
        break;
      }
      case "evidence": output += evidenceMarkdown(node, context); break;
      default: fail(`${context.label}: unsupported inline tag <${node.tag}>`);
    }
  }
  return output;
}

function quote(markdown) {
  return markdown.trim().split("\n").map((line) => line.length > 0 ? `> ${line}` : ">").join("\n");
}

function renderList(node, context, ordered) {
  return elementChildren(node, "li").map((item, index) => `${ordered ? `${index + 1}.` : "-"} ${inline(item.children, context).trim()}`).join("\n");
}

function cellMarkdown(cell, context) {
  return inline(cell.children, context, true).trim().replace(/\r?\n/g, "<br>");
}

function escapeHtml(value) {
  return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}

function rawTableHtml(node, context) {
  if (node.type === "text") return escapeHtml(decodeEntities(node.value, context.label));
  if (node.tag === "evidence") {
    const item = context.model.evidenceById.get(node.attrs.id);
    assert(item !== undefined, `${context.label}: unknown evidence id ${node.attrs.id}`);
    const title = context.lang === "en" ? item.titleEn : item.title;
    const support = context.lang === "en" ? item.supportsEn : item.supports;
    context.renderedEvidence.push(node.attrs.id);
    return `<a href="${escapeHtml(sourceUrl(item, context))}" title="${escapeHtml(`${title}: ${support}`.replace(/\s+/g, " "))}"><code>${escapeHtml(node.attrs.id)}</code></a>`;
  }
  const allowed = new Set(["table", "thead", "tbody", "tr", "th", "td", "p", "br", "small", "code", "strong", "em", "a", "span"]);
  assert(allowed.has(node.tag), `${context.label}: unsupported <${node.tag}> inside complex table`);
  const attributes = [];
  if (node.tag === "th" || node.tag === "td") {
    if (node.attrs.colspan !== undefined) attributes.push(`colspan="${node.attrs.colspan}"`);
    if (node.attrs.rowspan !== undefined) attributes.push(`rowspan="${node.attrs.rowspan}"`);
  }
  if (node.tag === "a") {
    const href = rewriteHref(node.attrs.href, context);
    context.renderedHrefs.push(href);
    attributes.push(`href="${escapeHtml(href)}"`);
  }
  if (node.tag === "span" && node.attrs.class !== undefined) attributes.push(`class="${escapeHtml(node.attrs.class)}"`);
  if ((node.tag === "code" || node.tag === "strong") && node.attrs.id !== undefined) {
    context.renderedAnchors.push(node.attrs.id);
    attributes.push(`id="${escapeHtml(node.attrs.id)}"`);
  }
  if (node.tag === "br") return "<br>";
  const inner = node.children.map((child) => rawTableHtml(child, context)).join("");
  return `<${node.tag}${attributes.length > 0 ? ` ${attributes.join(" ")}` : ""}>${inner}</${node.tag}>`;
}

function renderTable(node, context) {
  const head = elementChildren(node, "thead")[0];
  const body = elementChildren(node, "tbody")[0];
  const headerRows = elementChildren(head, "tr");
  const bodyRows = elementChildren(body, "tr");
  const allRows = [...headerRows, ...bodyRows];
  const hasSpan = allRows.some((row) => elementChildren(row).some((cell) => Number(cell.attrs.colspan ?? 1) !== 1 || Number(cell.attrs.rowspan ?? 1) !== 1));
  const headers = headerRows.length === 1 ? elementChildren(headerRows[0], "th") : [];
  const containsBlockCellContent = allRows.some((row) => elementChildren(row).some((cell) => cell.children.some((child) => child.type === "element" && child.tag === "p")));
  const simple = !hasSpan && !containsBlockCellContent && headerRows.length === 1 && headers.length > 0
    && bodyRows.every((row) => elementChildren(row, "td").length === headers.length && elementChildren(row).length === headers.length);
  if (!simple) return rawTableHtml(node, context);
  const lines = [
    `| ${headers.map((cell) => cellMarkdown(cell, context)).join(" | ")} |`,
    `| ${headers.map(() => "---").join(" | ")} |`,
  ];
  for (const row of bodyRows) lines.push(`| ${elementChildren(row, "td").map((cell) => cellMarkdown(cell, context)).join(" | ")} |`);
  return lines.join("\n");
}

function atlasText(value) {
  return escapeMarkdownText(String(value), true).replace(/\r?\n/g, "<br>");
}

function renderPackageAtlas(context) {
  const ui = COPY[context.lang];
  const { inventory } = context.model;
  const packagesByGroup = Object.groupBy(inventory.packages, (pkg) => pkg.group);
  const packageByName = new Map(inventory.packages.map((pkg) => [pkg.name, pkg]));
  const lines = [
    `**${ui.packageAtlas}:** ${inventory.counts.groups} ${ui.groups}; ${inventory.counts.packages} ${ui.packages}; ${inventory.counts.sourceFiles} ${ui.sourceFiles}; ${inventory.counts.testFiles} ${ui.testFiles}; ${inventory.counts.invariantPackages} ${ui.invariantPackages}; ${inventory.counts.patchBundles} ${ui.patchBundles}.`,
  ];
  for (const group of inventory.groups) {
    lines.push("", `##### ${escapeMarkdownText(group.name)}`, "",
      `| ${ui.package} | ${ui.description} | ${ui.dependencies} | ${ui.sourceFiles} | ${ui.testFiles} | ${ui.distribution} |`,
      "| --- | --- | --- | ---: | ---: | --- |");
    for (const pkg of packagesByGroup[group.name] ?? []) {
      const packageUrl = `${context.model.catalog.repository}/tree/${context.model.baseline.commit}/${encodeRepositoryPath(pkg.path)}`;
      const dependencies = pkg.internalDependencies.length === 0 ? `*${ui.none}*` : pkg.internalDependencies.map((name) => {
        const target = packageByName.get(name);
        const label = name.replace("@deepseek-ai/dsh-", "");
        return target === undefined ? `\`${atlasText(label)}\`` : `[\`${atlasText(label)}\`](${context.model.catalog.repository}/tree/${context.model.baseline.commit}/${encodeRepositoryPath(target.path)})`;
      }).join(" ");
      const flags = [pkg.hasCordisPatch ? ui.bundlePatch : "", pkg.private ? ui.private : ui.publishable].filter(Boolean).join(" · ");
      lines.push(`| [\`${atlasText(pkg.leaf)}\`](${packageUrl})<br><small>${atlasText(pkg.name)}</small> | ${atlasText(pkg.description || ui.noDescription)} | ${dependencies} | ${pkg.sourceFiles} | ${pkg.testFiles} | ${atlasText(flags)} |`);
    }
  }
  return lines.join("\n");
}

function renderDetails(node, context) {
  const children = meaningfulChildren(node);
  const summary = children[0];
  const body = renderBlocks(children.slice(1), context);
  const heading = inline(summary.children, context).trim();
  return body.length > 0 ? `**${heading}**\n\n${body}` : `**${heading}**`;
}

function renderBlocks(nodes, context) {
  const blocks = [];
  for (const node of nodes) {
    if (node.type === "text") {
      assert(node.value.trim().length === 0, `${context.label}: unexpected block text ${JSON.stringify(node.value.trim().slice(0, 40))}`);
      continue;
    }
    switch (node.tag) {
      case "section": {
        if (node.attrs.id !== undefined) context.renderedAnchors.push(node.attrs.id);
        const body = renderBlocks(node.children, context);
        blocks.push(node.attrs.id === undefined ? body : `<a id="${node.attrs.id}"></a>\n\n${body}`);
        break;
      }
      case "article": blocks.push(renderBlocks(node.children, context)); break;
      case "details": blocks.push(renderDetails(node, context)); break;
      case "h2": blocks.push(`#### ${inline(node.children, context).trim()}`); break;
      case "h3": blocks.push(`##### ${inline(node.children, context).trim()}`); break;
      case "p": {
        const text = inline(node.children, context).trim();
        blocks.push(hasClass(node, "eyebrow") ? `*${text}*` : text);
        break;
      }
      case "pre": {
        const code = elementChildren(node, "code")[0];
        const value = fragmentText(code, context.label).replaceAll("\r\n", "\n").replaceAll("\r", "\n");
        const runs = [...value.matchAll(/`+/g)].map((match) => match[0].length);
        const fence = "`".repeat(Math.max(3, ...runs.map((length) => length + 1)));
        blocks.push(`${fence}\n${value}${value.endsWith("\n") ? "" : "\n"}${fence}`);
        break;
      }
      case "ul": blocks.push(renderList(node, context, false)); break;
      case "ol": blocks.push(renderList(node, context, true)); break;
      case "aside": blocks.push(quote(inline(node.children, context).trim())); break;
      case "table": blocks.push(renderTable(node, context)); break;
      case "package-atlas": blocks.push(renderPackageAtlas(context)); break;
      case "div": {
        if (hasClass(node, "table-scroll")) {
          blocks.push(renderTable(elementChildren(node, "table")[0], context));
        } else if (hasClass(node, "claim")) {
          const label = elementChildren(node, "div").find((child) => hasClass(child, "claim-label"));
          const body = renderBlocks(node.children.filter((child) => child !== label), context);
          blocks.push(quote(`**${inline(label.children, context).trim()}**\n\n${body}`));
        } else if (hasClass(node, "thesis")) {
          blocks.push(quote(`**${COPY[context.lang].thesis}**\n\n${renderBlocks(node.children, context)}`));
        } else if (hasClass(node, "baseline-card")) {
          blocks.push(quote(inline(node.children, context).trim()));
        } else if (hasClass(node, "evidence-ladder")) {
          blocks.push(elementChildren(node, "div").map((item, index) => {
            const heading = elementChildren(item, "h3")[0];
            const paragraph = elementChildren(item, "p")[0];
            assert(heading !== undefined && paragraph !== undefined, `${context.label}: evidence-ladder item needs h3 and p`);
            return `${index + 1}. **${inline(heading.children, context).trim()}** — ${inline(paragraph.children, context).trim()}`;
          }).join("\n"));
        } else if (hasClass(node, "principle-grid")) {
          blocks.push(elementChildren(node, "div").map((item) => `- ${inline(item.children, context).trim()}`).join("\n"));
        } else if (hasClass(node, "question-grid")) {
          blocks.push(renderBlocks(elementChildren(node, "article"), context));
        } else if (hasClass(node, "claim-label")) {
          fail(`${context.label}: claim-label escaped its claim`);
        } else {
          fail(`${context.label}: unsupported div class ${JSON.stringify(node.attrs.class ?? "")}`);
        }
        break;
      }
      default: fail(`${context.label}: unsupported block tag <${node.tag}>`);
    }
  }
  return blocks.filter((block) => block.length > 0).join("\n\n");
}

function cleanMarkdown(value) {
  return value.replaceAll("\r\n", "\n").replaceAll("\r", "\n").trimEnd() + "\n";
}

function renderDocument(model, lang) {
  const language = model.languages[lang];
  const manifest = language.manifest;
  const ui = COPY[lang];
  const context = { model, lang, label: lang, renderedEvidence: [], renderedAnchors: [], renderedHrefs: [] };
  const lines = [
    `# ${escapeMarkdownText(manifest.title)}`,
    "",
    `[**${ui.defaultLanguage}**](./${OUTPUT_FILES.en}) · [${ui.otherLanguage}](./${OUTPUT_FILES.zh})`,
    "",
    `> **${ui.baseline}:** \`${model.baseline.commit}\``,
    "",
    `## ${ui.contents}`,
  ];
  let currentPart = null;
  for (const chapter of manifest.chapters) {
    if (chapter.part !== currentPart) {
      currentPart = chapter.part;
      lines.push("", `- **${escapeMarkdownText(currentPart)}**`);
    }
    lines.push(`  - [${escapeMarkdownLabel(chapter.id)} · ${escapeMarkdownLabel(chapter.title)}](#chapter-${chapter.id}-${chapter.slug}) — ${ui.statuses[chapter.status]}`);
  }
  currentPart = null;
  for (const record of language.chapters) {
    const { chapter } = record;
    if (chapter.part !== currentPart) {
      currentPart = chapter.part;
      lines.push("", "---", "", `## ${escapeMarkdownText(currentPart)}`);
    }
    lines.push("", `<a id="chapter-${chapter.id}-${chapter.slug}"></a>`, "", `### ${chapter.id} · ${escapeMarkdownText(chapter.title)}`, "", `*${escapeMarkdownText(chapter.subtitle)}*`, "",
      `> **${ui.status}:** ${ui.statuses[chapter.status]}`, ">", `> **${ui.scope}:** ${escapeMarkdownText(chapter.scope)}`);
    context.renderedAnchors.push(`chapter-${chapter.id}-${chapter.slug}`);
    if (chapter.status === "queued") lines.push("", quote(ui.queuedBody));
    else {
      context.label = `${lang}/${chapter.id}-${chapter.slug}`;
      lines.push("", renderBlocks(record.ast.children, context));
    }
  }
  const markdown = cleanMarkdown(lines.join("\n"));
  return { markdown, evidenceIds: context.renderedEvidence, anchorIds: context.renderedAnchors, hrefs: context.renderedHrefs };
}

function expectedHref(normalized, model, lang) {
  if (normalized.startsWith("fragment:")) return `#${normalized.slice("fragment:".length)}`;
  if (normalized.startsWith("chapter:")) {
    const slug = normalized.slice("chapter:".length);
    const chapter = model.languages[lang].manifest.chapters.find((item) => item.slug === slug);
    assert(chapter !== undefined, `${lang}: normalized href references unknown chapter ${slug}`);
    return `#chapter-${chapter.id}-${chapter.slug}`;
  }
  return encodeHref(normalized);
}

function validateRendered(model, rendered) {
  const expectedEvidence = model.languages.en.chapters.flatMap((record) => record.evidenceIds);
  for (const lang of Object.keys(rendered)) {
    const result = rendered[lang];
    assert(JSON.stringify(result.evidenceIds) === JSON.stringify(expectedEvidence), `${lang}: rendered evidence sequence differs from validated source sequence`);
    const manifest = model.languages[lang].manifest;
    const expectedAnchors = model.languages[lang].chapters.flatMap((record) => [
      `chapter-${record.chapter.id}-${record.chapter.slug}`,
      ...record.anchorIds,
    ]);
    const expectedHrefs = model.languages[lang].chapters.flatMap((record) => record.normalizedHrefs.map((href) => expectedHref(href, model, lang)));
    assert(JSON.stringify(result.anchorIds) === JSON.stringify(expectedAnchors), `${lang}: rendered anchor sequence differs from validated source sequence`);
    assert(JSON.stringify(result.hrefs) === JSON.stringify(expectedHrefs), `${lang}: rendered link target sequence differs from validated source sequence`);
    for (const chapter of manifest.chapters) {
      const anchor = `<a id="chapter-${chapter.id}-${chapter.slug}"></a>`;
      assert(result.markdown.split(anchor).length === 2, `${lang}/${chapter.slug}: chapter anchor must occur exactly once`);
      assert(result.markdown.includes(`](#chapter-${chapter.id}-${chapter.slug})`), `${lang}/${chapter.slug}: table of contents link is missing`);
    }
    assert(result.markdown.startsWith(`# ${manifest.title}\n\n[**${COPY[lang].defaultLanguage}**](./${OUTPUT_FILES.en}) · [${COPY[lang].otherLanguage}](./${OUTPUT_FILES.zh})`), `${lang}: English-first bilingual switch is missing`);
    assert(!result.markdown.includes("<evidence") && !result.markdown.includes("<package-atlas"), `${lang}: unresolved data component remains`);
    assert(!/(?:^|["'(\s])(?:\/home\/|\/Users\/|[A-Za-z]:\\)/m.test(result.markdown), `${lang}: absolute machine path leaked`);
    assert(!result.markdown.includes("\r") && !result.markdown.startsWith("\ufeff") && result.markdown.endsWith("\n") && !result.markdown.endsWith("\n\n"), `${lang}: output encoding or newline invariant failed`);
    assert(!/(?:^|["'(])(?:\.\.\/)*pages\/[a-z0-9-]+\.html/.test(result.markdown), `${lang}: legacy internal HTML link remains`);
  }
  assert(rendered.en.markdown.includes(`[**${COPY.en.defaultLanguage}**]`), "English must be the default report");
  assert(JSON.stringify(rendered.en.evidenceIds) === JSON.stringify(rendered.zh.evidenceIds), "rendered bilingual evidence sequence differs");
}

/**
 * Render both deterministic Markdown reports from a validated model.
 * @param {object} model Validated report model.
 * @returns {{en:{markdown:string,evidenceIds:string[]},zh:{markdown:string,evidenceIds:string[]}}} Bilingual Markdown outputs.
 */
export function renderReports(model) {
  const rendered = { en: renderDocument(model, "en"), zh: renderDocument(model, "zh") };
  validateRendered(model, rendered);
  return rendered;
}

/** Stable output filenames keyed by language. */
export const MARKDOWN_OUTPUT_FILES = Object.freeze({ ...OUTPUT_FILES });
