const ALLOWED_TAGS = new Set([
  "section", "h2", "h3", "p", "div", "pre", "code", "table", "thead", "tbody", "tr", "th", "td",
  "strong", "em", "small", "br", "aside", "ul", "ol", "li", "span", "a", "article", "details", "summary", "evidence", "package-atlas",
]);

const VOID_TAGS = new Set(["br"]);
const ANCHOR_TAGS = new Set(["section", "strong", "code"]);

const ATTRIBUTE_ALLOWLIST = {
  a: new Set(["href", "target", "rel"]),
  code: new Set(["id"]),
  details: new Set(["open"]),
  evidence: new Set(["id"]),
  section: new Set(["id"]),
  strong: new Set(["id"]),
  td: new Set(["colspan", "rowspan"]),
  th: new Set(["colspan", "rowspan"]),
};

const CLASS_SIGNATURES = new Map([
  ["section", new Set(["hero-panel"])],
  ["p", new Set(["eyebrow", "lede"])],
  ["div", new Set([
    "baseline-card", "assessment claim", "claim fact", "claim inference", "claim-label", "evidence-ladder",
    "principle-grid", "question-grid", "table-scroll", "thesis",
  ])],
  ["aside", new Set(["caveat"])],
  ["ul", new Set(["audit-list"])],
  ["ol", new Set(["audit-list", "reading-path"])],
  ["span", new Set(["drafting status", "queued status", "status verified"])],
  ["table", new Set(["package-table"])],
  ["details", new Set(["index-group"])],
]);

const INLINE_TAGS = new Set(["strong", "em", "small", "br", "code", "span", "a", "evidence"]);
const STATUS_CLASSES = new Set(["drafting", "queued", "verified"]);
const CLAIM_KINDS = new Set(["assessment", "fact", "inference"]);
const NAMED_ENTITIES = new Map([
  ["amp", "&"], ["lt", "<"], ["gt", ">"], ["quot", "\""], ["apos", "'"], ["nbsp", "\u00a0"],
]);

function fail(file, message) {
  throw new Error(`${file}: ${message}`);
}

function assertFor(file, condition, message) {
  if (!condition) fail(file, message);
}

function elementChildren(node, tag) {
  return node.children.filter((child) => child.type === "element" && (tag === undefined || child.tag === tag));
}

function textIsWhitespace(node) {
  return node.type === "text" && node.value.trim().length === 0;
}

function meaningfulChildren(node) {
  return node.children.filter((child) => !textIsWhitespace(child));
}

function canonicalClasses(value, file, tag) {
  const tokens = value.split(/\s+/).filter(Boolean);
  assertFor(file, tokens.length > 0, `<${tag}> has an empty class attribute`);
  assertFor(file, new Set(tokens).size === tokens.length, `<${tag}> repeats a class token`);
  return [...tokens].sort().join(" ");
}

function parseAttributes(source, file, rawTag) {
  const attributes = {};
  let offset = 0;
  while (offset < source.length) {
    const whitespace = /^\s+/.exec(source.slice(offset));
    if (whitespace !== null) offset += whitespace[0].length;
    if (offset >= source.length) break;
    const name = /^[a-z][a-z0-9-]*/.exec(source.slice(offset));
    if (name === null) fail(file, `invalid attribute syntax in ${rawTag}`);
    offset += name[0].length;
    const gap = /^\s*/.exec(source.slice(offset))[0];
    offset += gap.length;
    if (source[offset] !== "=") {
      assertFor(file, !Object.hasOwn(attributes, name[0]), `duplicate attribute ${name[0]} in ${rawTag}`);
      attributes[name[0]] = "";
      continue;
    }
    offset += 1;
    offset += /^\s*/.exec(source.slice(offset))[0].length;
    const quote = source[offset];
    assertFor(file, quote === "\"" || quote === "'", `attribute ${name[0]} must be quoted in ${rawTag}`);
    const end = source.indexOf(quote, offset + 1);
    assertFor(file, end >= 0, `unterminated attribute ${name[0]} in ${rawTag}`);
    assertFor(file, !Object.hasOwn(attributes, name[0]), `duplicate attribute ${name[0]} in ${rawTag}`);
    attributes[name[0]] = source.slice(offset + 1, end);
    offset = end + 1;
  }
  return attributes;
}

function scanTag(source, start, file) {
  let quote = null;
  for (let offset = start + 1; offset < source.length; offset += 1) {
    const character = source[offset];
    if (quote !== null) {
      if (character === quote) quote = null;
      continue;
    }
    if (character === "\"" || character === "'") quote = character;
    else if (character === ">") return [source.slice(start, offset + 1), offset + 1];
  }
  fail(file, `unterminated tag at byte ${start}`);
}

function validateAttributes(node, file) {
  const names = Object.keys(node.attrs);
  const allowlist = ATTRIBUTE_ALLOWLIST[node.tag] ?? new Set();
  for (const name of names) {
    if (name === "class") continue;
    assertFor(file, allowlist.has(name), `<${node.tag}> does not allow attribute ${name}`);
  }
  if (Object.hasOwn(node.attrs, "class")) {
    const signatures = CLASS_SIGNATURES.get(node.tag);
    assertFor(file, signatures !== undefined, `<${node.tag}> does not allow class`);
    const signature = canonicalClasses(node.attrs.class, file, node.tag);
    assertFor(file, signatures.has(signature), `<${node.tag}> has unsupported class ${JSON.stringify(node.attrs.class)}`);
    node.attrs.class = signature;
  }
  if (node.tag === "a") {
    assertFor(file, typeof node.attrs.href === "string" && node.attrs.href.length > 0, "<a> requires a non-empty href");
    if (node.attrs.target !== undefined) assertFor(file, node.attrs.target === "_blank", "<a> target may only be _blank");
    if (node.attrs.rel !== undefined) {
      const relations = node.attrs.rel.split(/\s+/).filter(Boolean);
      assertFor(file, relations.length > 0 && relations.every((item) => item === "noreferrer" || item === "noopener"), "<a> rel may only contain noreferrer/noopener");
    }
  }
  if (node.attrs.id !== undefined && node.tag !== "evidence") {
    assertFor(file, /^[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*$/.test(node.attrs.id), `<${node.tag}> id is invalid`);
    if (node.tag === "strong") assertFor(file, node.attrs.id.startsWith("term-"), "<strong> id must use the term- prefix");
    if (node.tag === "code") assertFor(file, node.attrs.id.startsWith("evidence-"), "<code> id must use the evidence- prefix");
  }
  if (node.tag === "details" && node.attrs.open !== undefined) assertFor(file, node.attrs.open === "", "<details> open must be a boolean attribute");
  if (node.tag === "evidence") {
    assertFor(file, typeof node.attrs.id === "string" && /^[A-Z0-9][A-Z0-9-]*$/.test(node.attrs.id), "<evidence> requires a valid id");
  }
  if (node.tag === "td" || node.tag === "th") {
    for (const name of ["colspan", "rowspan"]) {
      if (node.attrs[name] !== undefined) assertFor(file, /^[1-9]\d*$/.test(node.attrs[name]), `<${node.tag}> ${name} must be a positive integer`);
    }
  }
}

function validateInlineChildren(node, file) {
  for (const child of node.children) {
    if (child.type === "text") continue;
    assertFor(file, INLINE_TAGS.has(child.tag), `<${node.tag}> cannot contain <${child.tag}>`);
  }
}

function validateTableGroup(group, file, expectedWidth) {
  const rows = meaningfulChildren(group);
  assertFor(file, rows.length > 0 && rows.every((row) => row.type === "element" && row.tag === "tr"), `<${group.tag}> must contain one or more <tr> elements`);
  const occupied = [];
  let width = expectedWidth;
  for (const row of rows) {
    const cells = meaningfulChildren(row);
    assertFor(file, cells.length > 0 && cells.every((cell) => cell.type === "element" && (cell.tag === "th" || cell.tag === "td")), "<tr> must contain table cells only");
    let cursor = 0;
    for (const cell of cells) {
      while ((occupied[cursor] ?? 0) > 0) cursor += 1;
      const colspan = Number(cell.attrs.colspan ?? 1);
      const rowspan = Number(cell.attrs.rowspan ?? 1);
      for (let index = cursor; index < cursor + colspan; index += 1) {
        assertFor(file, (occupied[index] ?? 0) === 0, "table spans overlap");
        occupied[index] = rowspan;
      }
      cursor += colspan;
    }
    const rowWidth = occupied.length;
    if (width === undefined) width = rowWidth;
    assertFor(file, rowWidth === width && occupied.slice(0, width).every((count) => count > 0), `table row has effective width ${rowWidth}; expected ${width}`);
    for (let index = 0; index < occupied.length; index += 1) occupied[index] = Math.max(0, occupied[index] - 1);
  }
  assertFor(file, occupied.every((count) => count === 0), `<${group.tag}> ends before a rowspan is complete`);
  return width;
}

function validateTable(node, file) {
  const children = meaningfulChildren(node);
  assertFor(file, children.length === 2 && children[0].type === "element" && children[0].tag === "thead" && children[1].type === "element" && children[1].tag === "tbody", "<table> must contain exactly <thead> followed by <tbody>");
  const width = validateTableGroup(children[0], file, undefined);
  assertFor(file, width > 0, "<table> must have at least one column");
  validateTableGroup(children[1], file, width);
}

function hasClass(node, name) {
  return (node.attrs.class ?? "").split(" ").includes(name);
}

function validateElement(node, parent, file, state) {
  validateAttributes(node, file);
  if (node.tag === "root") return;
  if (node.tag === "section") assertFor(file, parent.tag === "root", "<section> must be a top-level fragment element");
  if (node.tag === "article") assertFor(file, parent.tag === "div" && hasClass(parent, "question-grid"), "<article> is allowed only inside question-grid");
  if (node.tag === "evidence" || node.tag === "package-atlas") {
    assertFor(file, meaningfulChildren(node).length === 0, `<${node.tag}> must be empty`);
    if (node.tag === "package-atlas") {
      assertFor(file, Object.keys(node.attrs).length === 0, "<package-atlas> does not allow attributes");
      state.packageAtlasCount += 1;
      assertFor(file, state.packageAtlasCount <= 1, "a fragment may contain at most one <package-atlas>");
    }
  }
  if (ANCHOR_TAGS.has(node.tag) && node.attrs.id !== undefined) {
    assertFor(file, !state.anchorIds.has(node.attrs.id), `duplicate fragment anchor id ${node.attrs.id}`);
    state.anchorIds.add(node.attrs.id);
  }
  if (["h2", "h3", "p", "th", "aside", "li", "summary"].includes(node.tag)) validateInlineChildren(node, file);
  if (node.tag === "td") {
    for (const child of node.children) {
      if (child.type === "text") continue;
      assertFor(file, INLINE_TAGS.has(child.tag) || child.tag === "p", `<td> cannot contain <${child.tag}>`);
    }
  }
  if (["strong", "em", "small", "span", "a"].includes(node.tag)) validateInlineChildren(node, file);
  if (node.tag === "a") {
    assertFor(file, elementChildren(node).every((child) => child.tag !== "a" && child.tag !== "evidence"), "<a> cannot contain links or evidence components");
  }
  if (node.tag === "code") assertFor(file, node.children.every((child) => child.type === "text"), "<code> may contain text only");
  if (node.tag === "br") assertFor(file, node.children.length === 0, "<br> must be empty");
  if (INLINE_TAGS.has(node.tag)) {
    const forbiddenParents = new Set(["root", "section", "article", "details", "table", "thead", "tbody", "tr", "ul", "ol"]);
    assertFor(file, !forbiddenParents.has(parent.tag), `<${node.tag}> must be inside an inline-capable container`);
  }
  if (node.tag === "evidence") assertFor(file, parent.tag !== "a" && parent.tag !== "pre" && parent.tag !== "code", "<evidence> is not allowed in this parent");
  if (node.tag === "package-atlas") assertFor(file, parent.tag === "section" || parent.tag === "details", "<package-atlas> must be a report block");
  if (node.tag === "pre") {
    const children = meaningfulChildren(node);
    assertFor(file, children.length === 1 && children[0].type === "element" && children[0].tag === "code", "<pre> must contain exactly one <code> element");
  }
  if (node.tag === "table") validateTable(node, file);
  if (node.tag === "thead" || node.tag === "tbody") {
    assertFor(file, parent.tag === "table", `<${node.tag}> must be a direct child of <table>`);
  }
  if (node.tag === "tr") assertFor(file, parent.tag === "thead" || parent.tag === "tbody", "<tr> must be inside <thead> or <tbody>");
  if (node.tag === "th" || node.tag === "td") assertFor(file, parent.tag === "tr", `<${node.tag}> must be inside <tr>`);
  if (node.tag === "li") assertFor(file, parent.tag === "ul" || parent.tag === "ol", "<li> must be inside a list");
  if (node.tag === "summary") assertFor(file, parent.tag === "details", "<summary> must be a direct child of <details>");
  if (node.tag === "details") {
    const children = meaningfulChildren(node);
    assertFor(file, children.length >= 1 && children[0].type === "element" && children[0].tag === "summary", "<details> must start with exactly one <summary>");
    assertFor(file, children.filter((child) => child.type === "element" && child.tag === "summary").length === 1, "<details> must contain exactly one <summary>");
  }
  if (node.tag === "ul" || node.tag === "ol") {
    const children = meaningfulChildren(node);
    assertFor(file, children.length > 0 && children.every((child) => child.type === "element" && child.tag === "li"), `<${node.tag}> must contain one or more <li> elements`);
  }
  if (node.tag === "div" && hasClass(node, "claim")) {
    const kind = node.attrs.class.split(" ").find((name) => CLAIM_KINDS.has(name));
    assertFor(file, kind !== undefined, "claim must declare exactly one known kind");
    const labels = elementChildren(node, "div").filter((child) => hasClass(child, "claim-label"));
    assertFor(file, labels.length === 1, "claim must contain exactly one claim-label");
  }
  if (node.tag === "div" && hasClass(node, "claim-label")) {
    assertFor(file, parent.tag === "div" && hasClass(parent, "claim"), "claim-label must be a direct child of a claim");
    validateInlineChildren(node, file);
  }
  if (node.tag === "div" && hasClass(node, "table-scroll")) {
    const children = meaningfulChildren(node);
    assertFor(file, children.length === 1 && children[0].type === "element" && children[0].tag === "table", "table-scroll must contain exactly one table");
  }
  if (node.tag === "div" && hasClass(node, "question-grid")) {
    const children = meaningfulChildren(node);
    assertFor(file, children.length > 0 && children.every((child) => child.type === "element" && child.tag === "article"), "question-grid must contain one or more <article> elements");
  }
  if (node.tag === "div" && hasClass(node, "principle-grid")) {
    const children = meaningfulChildren(node);
    assertFor(file, children.length > 0 && children.every((child) => child.type === "element" && child.tag === "div" && child.attrs.class === undefined), "principle-grid must contain unclassified <div> items");
  }
  if (node.tag === "div" && hasClass(node, "evidence-ladder")) {
    const children = meaningfulChildren(node);
    assertFor(file, children.length > 0 && children.every((child) => child.type === "element" && child.tag === "div" && child.attrs.class === undefined), "evidence-ladder must contain unclassified <div> items");
    for (const child of children) {
      const tags = meaningfulChildren(child).map((item) => item.type === "element" ? item.tag : "#text");
      assertFor(file, tags.join(",") === "span,h3,p", "evidence-ladder items must contain span, h3, and p in order");
    }
  }
  if (node.tag === "div" && hasClass(node, "baseline-card")) validateInlineChildren(node, file);
  if (node.tag === "div" && node.attrs.class === undefined) {
    assertFor(file, parent.tag === "div" && (hasClass(parent, "evidence-ladder") || hasClass(parent, "principle-grid")), "unclassified <div> is allowed only as a controlled grid item");
  }
  if (node.tag === "span" && hasClass(node, "status")) {
    const status = node.attrs.class.split(" ").find((name) => STATUS_CLASSES.has(name));
    assertFor(file, status !== undefined, "status span must declare a known status");
  }
  for (const child of node.children) {
    if (child.type === "text") decodeEntities(child.value, file);
    else validateElement(child, node, file, state);
  }
}

function freezeTree(node) {
  if (node.type === "element") {
    Object.freeze(node.attrs);
    for (const child of node.children) freezeTree(child);
    Object.freeze(node.children);
  }
  Object.freeze(node);
}

/**
 * Decode the intentionally small HTML entity vocabulary accepted by report fragments.
 * @param {string} value Encoded fragment text or attribute value.
 * @param {string} [file] Source label used in failures.
 * @returns {string} Decoded Unicode text.
 */
export function decodeEntities(value, file = "<fragment>") {
  let output = "";
  for (let offset = 0; offset < value.length;) {
    if (value[offset] !== "&") {
      output += value[offset];
      offset += 1;
      continue;
    }
    const match = /^&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]+);/i.exec(value.slice(offset));
    if (match === null) fail(file, `malformed or unescaped entity at byte ${offset}`);
    const entity = match[1];
    if (entity.startsWith("#")) {
      const hexadecimal = entity[1]?.toLowerCase() === "x";
      const codePoint = Number.parseInt(entity.slice(hexadecimal ? 2 : 1), hexadecimal ? 16 : 10);
      assertFor(file, Number.isInteger(codePoint) && codePoint > 0 && codePoint <= 0x10ffff && !(codePoint >= 0xd800 && codePoint <= 0xdfff), `invalid numeric entity &${entity};`);
      output += String.fromCodePoint(codePoint);
    } else {
      assertFor(file, NAMED_ENTITIES.has(entity), `unsupported entity &${entity};`);
      output += NAMED_ENTITIES.get(entity);
    }
    offset += match[0].length;
  }
  return output;
}

/**
 * Parse and validate one controlled report fragment without a browser DOM.
 * @param {string} source Fragment source.
 * @param {string} [file] Source label used in failures.
 * @returns {{type:"element",tag:"root",attrs:Record<string,string>,children:Array<object>}} Frozen fragment AST.
 */
export function parseFragment(source, file = "<fragment>") {
  assertFor(file, typeof source === "string", "fragment source must be a string");
  assertFor(file, !source.startsWith("\ufeff"), "UTF-8 BOM is not allowed");
  const normalized = source.replaceAll("\r\n", "\n").replaceAll("\r", "\n");
  const root = { type: "element", tag: "root", attrs: {}, children: [] };
  const stack = [root];
  let offset = 0;
  while (offset < normalized.length) {
    const current = stack.at(-1);
    if (current?.tag === "code" && stack.at(-2)?.tag === "pre") {
      const end = normalized.indexOf("</code>", offset);
      assertFor(file, end >= 0, "raw <pre><code> block has no closing </code>");
      current.children.push({ type: "text", value: normalized.slice(offset, end) });
      offset = end;
    }
    const lessThan = normalized.indexOf("<", offset);
    if (lessThan < 0) {
      stack.at(-1).children.push({ type: "text", value: normalized.slice(offset) });
      offset = normalized.length;
      break;
    }
    if (lessThan > offset) stack.at(-1).children.push({ type: "text", value: normalized.slice(offset, lessThan) });
    assertFor(file, !normalized.startsWith("<!--", lessThan), "comments are not part of the fragment grammar");
    const [rawTag, nextOffset] = scanTag(normalized, lessThan, file);
    offset = nextOffset;
    const close = /^<\/([a-z][a-z0-9-]*)\s*>$/.exec(rawTag);
    if (close !== null) {
      assertFor(file, stack.length > 1, `closing </${close[1]}> without an open element`);
      const top = stack.pop();
      assertFor(file, top.tag === close[1], `closing </${close[1]}> while <${top.tag}> is open`);
      continue;
    }
    const open = /^<([a-z][a-z0-9-]*)([\s\S]*?)>$/.exec(rawTag);
    assertFor(file, open !== null && !open[2].trimEnd().endsWith("/"), `invalid or self-closing tag ${rawTag}`);
    const tag = open[1];
    assertFor(file, ALLOWED_TAGS.has(tag), `unsupported tag <${tag}>`);
    const node = { type: "element", tag, attrs: parseAttributes(open[2], file, rawTag), children: [] };
    stack.at(-1).children.push(node);
    if (!VOID_TAGS.has(tag)) stack.push(node);
  }
  assertFor(file, stack.length === 1, `unclosed tag <${stack.at(-1).tag}>`);
  const topLevel = meaningfulChildren(root);
  assertFor(file, topLevel.length > 0 && topLevel.every((node) => node.type === "element" && node.tag === "section"), "fragment root must contain one or more <section> elements");
  const state = { packageAtlasCount: 0, anchorIds: new Set() };
  for (const child of topLevel) validateElement(child, root, file, state);
  freezeTree(root);
  return root;
}

/**
 * Return decoded descendant text for renderers and structural checks.
 * @param {object} node Fragment AST node.
 * @param {string} [file] Source label used in failures.
 * @returns {string} Decoded descendant text.
 */
export function fragmentText(node, file = "<fragment>") {
  if (node.type === "text") return decodeEntities(node.value, file);
  return node.children.map((child) => fragmentText(child, file)).join("");
}

/**
 * Collect semantic tokens whose order and cardinality must agree across translations.
 * @param {object} root Fragment AST root.
 * @returns {string[]} Ordered language-neutral fingerprint.
 */
export function semanticFingerprint(root) {
  const tokens = [];
  const visit = (node, parent) => {
    if (node.type === "text") return;
    if (ANCHOR_TAGS.has(node.tag) && node.attrs.id !== undefined) tokens.push(`anchor:${node.tag}:${node.attrs.id}`);
    if (node.tag === "section") tokens.push(`section:${node.attrs.id ?? ""}:${node.attrs.class ?? ""}`);
    else if (node.tag === "h2" || node.tag === "h3") tokens.push(`heading:${node.tag}`);
    else if (node.tag === "ul" || node.tag === "ol") tokens.push(`list:${node.tag}:${elementChildren(node, "li").length}`);
    else if (node.tag === "pre") tokens.push("code-block");
    else if (node.tag === "table") {
      tokens.push("table:start");
      for (const group of elementChildren(node)) {
        tokens.push(`table-group:${group.tag}:${elementChildren(group, "tr").length}`);
        for (const row of elementChildren(group, "tr")) {
          const cells = elementChildren(row);
          tokens.push(`table-row:${cells.map((cell) => `${cell.tag}:${cell.attrs.colspan ?? 1}:${cell.attrs.rowspan ?? 1}`).join(",")}`);
        }
      }
      tokens.push("table:end");
    } else if (node.tag === "package-atlas") tokens.push("package-atlas");
    else if (node.tag === "aside") tokens.push("aside");
    else if (node.tag === "details") tokens.push(`details:${node.attrs.class ?? ""}:${node.attrs.open !== undefined ? "open" : "closed"}`);
    else if (node.tag === "summary") tokens.push("summary");
    else if (node.tag === "div" && hasClass(node, "claim")) tokens.push(`claim:${node.attrs.class}`);
    else if (node.tag === "div" && hasClass(node, "claim-label")) tokens.push("claim-label");
    else if (node.tag === "div" && hasClass(node, "thesis")) tokens.push("thesis");
    else if (node.tag === "div" && ["evidence-ladder", "principle-grid", "question-grid"].some((name) => hasClass(node, name))) {
      tokens.push(`grid:${node.attrs.class}:${elementChildren(node).length}`);
    }
    for (const child of node.children) visit(child, node);
  };
  visit(root, { tag: "root" });
  return tokens;
}

/**
 * Collect custom evidence IDs in source order, including repeated citations.
 * @param {object} root Fragment AST root.
 * @returns {string[]} Ordered evidence IDs.
 */
export function evidenceSequence(root) {
  const ids = [];
  const visit = (node) => {
    if (node.type === "text") return;
    if (node.tag === "evidence") ids.push(node.attrs.id);
    for (const child of node.children) visit(child);
  };
  visit(root);
  return ids;
}

/**
 * Collect explicit external links in source order.
 * @param {object} root Fragment AST root.
 * @param {string} [file] Source label used in failures.
 * @returns {string[]} Ordered decoded hrefs.
 */
export function externalHrefSequence(root, file = "<fragment>") {
  const hrefs = [];
  const visit = (node) => {
    if (node.type === "text") return;
    if (node.tag === "a") {
      const href = decodeEntities(node.attrs.href, file);
      if (/^(?:https?:|mailto:)/.test(href)) hrefs.push(href);
    }
    for (const child of node.children) visit(child);
  };
  visit(root);
  return hrefs;
}

/**
 * Collect every explicit link target in source order.
 * @param {object} root Fragment AST root.
 * @param {string} [file] Source label used in failures.
 * @returns {string[]} Ordered decoded hrefs.
 */
export function hrefSequence(root, file = "<fragment>") {
  const hrefs = [];
  const visit = (node) => {
    if (node.type === "text") return;
    if (node.tag === "a") hrefs.push(decodeEntities(node.attrs.href, file));
    for (const child of node.children) visit(child);
  };
  visit(root);
  return hrefs;
}

/**
 * Collect every declared fragment anchor ID in source order.
 * @param {object} root Fragment AST root.
 * @returns {string[]} Ordered anchor IDs.
 */
export function anchorIdSequence(root) {
  const ids = [];
  const visit = (node) => {
    if (node.type === "text") return;
    if (ANCHOR_TAGS.has(node.tag) && node.attrs.id !== undefined) ids.push(node.attrs.id);
    for (const child of node.children) visit(child);
  };
  visit(root);
  return ids;
}
