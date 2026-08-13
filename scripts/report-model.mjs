import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import {
  anchorIdSequence,
  evidenceSequence,
  externalHrefSequence,
  hrefSequence,
  parseFragment,
  semanticFingerprint,
} from "./fragment-parser.mjs";

const LANGUAGES = ["en", "zh"];
const ALLOWED_STATUSES = new Set(["queued", "drafting", "verified"]);
const COMMIT_PATTERN = /^[0-9a-f]{40}$/;
const ID_PATTERN = /^\d+$/;
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const EVIDENCE_ID_PATTERN = /^[A-Z0-9][A-Z0-9-]*$/;
const SOURCE_CHECK_MODES = new Set(["auto", "off", "required"]);

function fail(message) {
  throw new Error(message);
}

function assert(condition, message) {
  if (!condition) fail(message);
}

function assertString(value, label) {
  assert(typeof value === "string" && value.trim().length > 0, `${label} must be a non-empty string`);
}

function readUtf8(path, label) {
  let value;
  try {
    value = readFileSync(path, "utf8");
  } catch (error) {
    fail(`${label}: ${error.message}`);
  }
  assert(!value.startsWith("\ufeff"), `${label}: UTF-8 BOM is not allowed`);
  return value.replaceAll("\r\n", "\n").replaceAll("\r", "\n");
}

function readJson(path, label) {
  try {
    return JSON.parse(readUtf8(path, label));
  } catch (error) {
    if (error instanceof SyntaxError) fail(`${label}: invalid JSON: ${error.message}`);
    throw error;
  }
}

function assertPlainObject(value, label) {
  assert(value !== null && typeof value === "object" && !Array.isArray(value), `${label} must be an object`);
}

function validateManifest(manifest, lang) {
  assertPlainObject(manifest, `${lang} manifest`);
  assertString(manifest.title, `${lang} manifest title`);
  assertString(manifest.description, `${lang} manifest description`);
  assert(Array.isArray(manifest.chapters) && manifest.chapters.length > 0, `${lang} manifest must contain chapters`);
  const ids = new Set();
  const slugs = new Set();
  for (const [index, chapter] of manifest.chapters.entries()) {
    const label = `${lang} chapter[${index}]`;
    assertPlainObject(chapter, label);
    for (const field of ["id", "slug", "part", "title", "subtitle", "status", "scope"]) assertString(chapter[field], `${label}.${field}`);
    assert(ID_PATTERN.test(chapter.id), `${label}.id must contain decimal digits only`);
    assert(SLUG_PATTERN.test(chapter.slug), `${label}.slug is invalid`);
    assert(ALLOWED_STATUSES.has(chapter.status), `${label}.status is unsupported: ${chapter.status}`);
    assert(!ids.has(chapter.id), `${lang}: duplicate chapter id ${chapter.id}`);
    assert(!slugs.has(chapter.slug), `${lang}: duplicate chapter slug ${chapter.slug}`);
    ids.add(chapter.id);
    slugs.add(chapter.slug);
  }
}

function validateManifestParity(manifests) {
  assert(manifests.en.chapters.length === manifests.zh.chapters.length, "English and Chinese manifests have different chapter counts");
  for (const [index, english] of manifests.en.chapters.entries()) {
    const chinese = manifests.zh.chapters[index];
    for (const field of ["id", "slug", "status"]) {
      assert(english[field] === chinese[field], `bilingual manifest mismatch at chapter[${index}].${field}`);
    }
  }
}

function validateRelativePath(value, label) {
  assertString(value, label);
  assert(!isAbsolute(value) && !value.includes("\\"), `${label} must be a forward-slash repository-relative path`);
  const segments = value.split("/");
  assert(segments.every((segment) => segment.length > 0 && segment !== "." && segment !== ".."), `${label} contains an unsafe path segment`);
}

function parseLineRange(value, label) {
  assert(typeof value === "string" && /^\d+(?:-\d+)?$/.test(value), `${label} must be N or N-M`);
  const [startText, endText = startText] = value.split("-");
  const start = Number(startText);
  const end = Number(endText);
  assert(Number.isSafeInteger(start) && start > 0 && Number.isSafeInteger(end) && end >= start, `${label} is not an increasing positive line range`);
  return { start, end };
}

function validateCatalog(catalog, baseline) {
  assertPlainObject(catalog, "evidence catalog");
  assert(COMMIT_PATTERN.test(catalog.baseline), "evidence catalog baseline must be a full lowercase commit hash");
  assert(catalog.baseline === baseline.commit, "evidence catalog baseline differs from research baseline");
  assertString(catalog.repository, "evidence catalog repository");
  const repository = new URL(catalog.repository);
  assert(repository.protocol === "https:" && repository.username === "" && repository.password === "" && repository.search === "" && repository.hash === "", "evidence catalog repository must be a clean HTTPS URL");
  catalog.repository = catalog.repository.replace(/\/+$/, "");
  assert(Array.isArray(catalog.items), "evidence catalog items must be an array");
  const byId = new Map();
  for (const [index, item] of catalog.items.entries()) {
    const label = `evidence item[${index}]`;
    assertPlainObject(item, label);
    assertString(item.id, `${label}.id`);
    assert(EVIDENCE_ID_PATTERN.test(item.id), `${label}.id is invalid`);
    assert(!byId.has(item.id), `duplicate evidence id ${item.id}`);
    for (const field of ["kind", "path", "title", "supports", "titleEn", "supportsEn"]) assertString(item[field], `${label}.${field}`);
    validateRelativePath(item.path, `${label}.path`);
    item.lineRange = parseLineRange(item.lines, `${label}.lines`);
    byId.set(item.id, item);
  }
  return byId;
}

function validateBaseline(baseline) {
  assertPlainObject(baseline, "research baseline");
  assert(COMMIT_PATTERN.test(baseline.commit), "research baseline commit must be a full lowercase commit hash");
  assertString(baseline.repository, "research baseline repository");
  const repository = baseline.repository.replace(/\/+$/, "");
  const parsed = new URL(repository);
  assert(parsed.protocol === "https:", "research baseline repository must use HTTPS");
  baseline.repository = repository;
}

function validateInventory(inventory, baseline) {
  assertPlainObject(inventory, "package inventory");
  assert(inventory.baseline === baseline.commit, "package inventory baseline differs from research baseline");
  assertPlainObject(inventory.counts, "package inventory counts");
  assert(Array.isArray(inventory.groups), "package inventory groups must be an array");
  assert(Array.isArray(inventory.packages), "package inventory packages must be an array");
  const groupNames = new Set();
  const computedGroups = new Map();
  for (const [index, group] of inventory.groups.entries()) {
    const label = `package group[${index}]`;
    assertPlainObject(group, label);
    assertString(group.name, `${label}.name`);
    assert(!groupNames.has(group.name), `duplicate package group ${group.name}`);
    groupNames.add(group.name);
    for (const field of ["packageCount", "sourceFiles", "testFiles"]) assert(Number.isSafeInteger(group[field]) && group[field] >= 0, `${label}.${field} must be a non-negative integer`);
    computedGroups.set(group.name, { packageCount: 0, sourceFiles: 0, testFiles: 0 });
  }
  const packageNames = new Set();
  const packagePaths = new Set();
  for (const [index, pkg] of inventory.packages.entries()) {
    const label = `package[${index}]`;
    assertPlainObject(pkg, label);
    for (const field of ["group", "leaf", "name", "path"]) assertString(pkg[field], `${label}.${field}`);
    validateRelativePath(pkg.path, `${label}.path`);
    assert(groupNames.has(pkg.group), `${label}.group references unknown group ${pkg.group}`);
    assert(!packageNames.has(pkg.name), `duplicate package name ${pkg.name}`);
    assert(!packagePaths.has(pkg.path), `duplicate package path ${pkg.path}`);
    packageNames.add(pkg.name);
    packagePaths.add(pkg.path);
    assert(typeof pkg.description === "string", `${label}.description must be a string`);
    assert(Array.isArray(pkg.internalDependencies) && pkg.internalDependencies.every((value) => typeof value === "string"), `${label}.internalDependencies must be a string array`);
    for (const field of ["sourceFiles", "testFiles"]) assert(Number.isSafeInteger(pkg[field]) && pkg[field] >= 0, `${label}.${field} must be a non-negative integer`);
    for (const field of ["private", "hasInvariant", "hasCordisPatch"]) assert(typeof pkg[field] === "boolean", `${label}.${field} must be boolean`);
    const aggregate = computedGroups.get(pkg.group);
    aggregate.packageCount += 1;
    aggregate.sourceFiles += pkg.sourceFiles;
    aggregate.testFiles += pkg.testFiles;
  }
  for (const group of inventory.groups) {
    const computed = computedGroups.get(group.name);
    for (const field of ["packageCount", "sourceFiles", "testFiles"]) assert(group[field] === computed[field], `package group ${group.name}.${field} does not match package records`);
  }
  const expectedCounts = {
    groups: inventory.groups.length,
    packages: inventory.packages.length,
    sourceFiles: inventory.packages.reduce((sum, pkg) => sum + pkg.sourceFiles, 0),
    testFiles: inventory.packages.reduce((sum, pkg) => sum + pkg.testFiles, 0),
    invariantPackages: inventory.packages.filter((pkg) => pkg.hasInvariant).length,
    patchBundles: inventory.packages.filter((pkg) => pkg.hasCordisPatch).length,
  };
  for (const [field, value] of Object.entries(expectedCounts)) assert(inventory.counts[field] === value, `package inventory counts.${field} is stale`);
  for (const pkg of inventory.packages) {
    for (const dependency of pkg.internalDependencies) assertString(dependency, `${pkg.name} internal dependency`);
  }
}

function sourcePath(repoRoot, lang, chapter) {
  return lang === "en"
    ? join(repoRoot, "content", "en", `${chapter.id}-${chapter.slug}.html`)
    : join(repoRoot, "content", `${chapter.id}-${chapter.slug}.html`);
}

function normalizeHref(value, label, slugSet, anchorIds) {
  assert(!/[\u0000-\u001f\u007f]/.test(value), `${label}: href contains a control character`);
  if (/^(?:https?:|mailto:)/.test(value)) {
    const parsed = new URL(value);
    assert(["http:", "https:", "mailto:"].includes(parsed.protocol), `${label}: unsupported href protocol`);
    return value;
  }
  if (value.startsWith("#")) {
    const target = value.slice(1);
    assert(target.length > 0 && anchorIds.has(target), `${label}: href targets unknown fragment anchor ${value}`);
    return `fragment:${target}`;
  }
  const match = /^(?:(?:\.\.\/)*pages\/)?([a-z0-9-]+)\.html(#[^\s]*)?$/.exec(value);
  assert(match !== null && slugSet.has(match[1]), `${label}: unsupported or unknown relative href ${value}`);
  return `chapter:${match[1]}`;
}

/**
 * Assert the translation-invariant structure and reference targets of one bilingual chapter.
 * @param {object} english English chapter projection.
 * @param {object} chinese Chinese chapter projection.
 * @returns {void}
 */
export function assertBilingualChapterParity(english, chinese) {
  const label = `${english.chapter.id}-${english.chapter.slug}`;
  assert(JSON.stringify(english.evidenceIds) === JSON.stringify(chinese.evidenceIds), `${label}: bilingual evidence occurrence sequence differs`);
  assert(JSON.stringify(english.externalHrefs) === JSON.stringify(chinese.externalHrefs), `${label}: bilingual external href sequence differs`);
  assert(JSON.stringify(english.normalizedHrefs) === JSON.stringify(chinese.normalizedHrefs), `${label}: bilingual link target sequence differs`);
  assert(JSON.stringify(english.anchorIds) === JSON.stringify(chinese.anchorIds), `${label}: bilingual anchor ID sequence differs`);
  assert(JSON.stringify(english.fingerprint) === JSON.stringify(chinese.fingerprint), `${label}: bilingual semantic fingerprint differs`);
}

function validatePinnedSources(baseline, catalog, mode, root) {
  if (mode === "off") return { performed: false, reason: "disabled" };
  if (!existsSync(root)) {
    if (mode === "required") fail("pinned source checkout is unavailable");
    return { performed: false, reason: "checkout-unavailable" };
  }
  let head;
  let dirty;
  let trackedPaths;
  try {
    head = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
    dirty = execFileSync("git", ["status", "--porcelain", "--untracked-files=no"], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
    trackedPaths = new Set(execFileSync("git", ["ls-tree", "-r", "--name-only", "-z", baseline.commit], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).split("\0").filter(Boolean));
  } catch (error) {
    if (mode === "required") fail(`cannot inspect pinned source checkout: ${error.message}`);
    return { performed: false, reason: "checkout-not-readable" };
  }
  if (head !== baseline.commit || dirty.length > 0) {
    if (mode === "required") fail(`pinned source checkout is not a clean ${baseline.commit}`);
    return { performed: false, reason: head !== baseline.commit ? "checkout-head-mismatch" : "checkout-dirty" };
  }
  const lineCounts = new Map();
  for (const item of catalog.items) {
    assert(trackedPaths.has(item.path), `${item.id}: source path is not tracked at ${baseline.commit}: ${item.path}`);
    const absolute = resolve(root, ...item.path.split("/"));
    const back = relative(root, absolute);
    assert(back.length > 0 && back !== ".." && !back.startsWith(`..${sep}`) && !isAbsolute(back), `${item.id}: source path escapes checkout`);
    assert(existsSync(absolute) && statSync(absolute).isFile(), `${item.id}: pinned source file is missing: ${item.path}`);
    let count = lineCounts.get(absolute);
    if (count === undefined) {
      const source = readFileSync(absolute, "utf8").replaceAll("\r\n", "\n").replaceAll("\r", "\n");
      count = source.length === 0 ? 0 : source.endsWith("\n") ? source.split("\n").length - 1 : source.split("\n").length;
      lineCounts.set(absolute, count);
    }
    assert(item.lineRange.end <= count, `${item.id}: line ${item.lineRange.end} exceeds ${item.path} (${count} lines)`);
  }
  return { performed: true, reason: "verified", files: lineCounts.size, items: catalog.items.length };
}

/**
 * Load, validate, and correlate every input needed for bilingual report rendering.
 * @param {{repoRoot:string,sourceCheck?:"auto"|"off"|"required",upstreamRoot?:string}} options Model options.
 * @returns {object} Validated bilingual report model.
 */
export function buildReportModel({ repoRoot, sourceCheck = "auto", upstreamRoot }) {
  assertString(repoRoot, "repoRoot");
  assert(SOURCE_CHECK_MODES.has(sourceCheck), `unsupported source-check mode ${sourceCheck}`);
  const root = resolve(repoRoot);
  if (upstreamRoot !== undefined) assertString(upstreamRoot, "upstreamRoot");
  const pinnedSourceRoot = upstreamRoot === undefined ? resolve(root, "..", "deepseek-harness") : resolve(upstreamRoot);
  const manifests = {
    en: readJson(join(root, "content", "chapters.en.json"), "English manifest"),
    zh: readJson(join(root, "content", "chapters.json"), "Chinese manifest"),
  };
  for (const lang of LANGUAGES) validateManifest(manifests[lang], lang);
  validateManifestParity(manifests);
  const baseline = readJson(join(root, "research", "baseline.json"), "research baseline");
  validateBaseline(baseline);
  const catalog = readJson(join(root, "evidence", "catalog.json"), "evidence catalog");
  const evidenceById = validateCatalog(catalog, baseline);
  assert(catalog.repository === baseline.repository, "evidence catalog repository differs from research baseline");
  const inventory = readJson(join(root, "research", "package-inventory.json"), "package inventory");
  validateInventory(inventory, baseline);
  const slugSet = new Set(manifests.en.chapters.map((chapter) => chapter.slug));
  const languages = { en: { manifest: manifests.en, chapters: [] }, zh: { manifest: manifests.zh, chapters: [] } };
  for (const [index, englishChapter] of manifests.en.chapters.entries()) {
    const chineseChapter = manifests.zh.chapters[index];
    if (englishChapter.status === "queued") {
      languages.en.chapters.push({ chapter: englishChapter, ast: null, evidenceIds: [], externalHrefs: [], normalizedHrefs: [], anchorIds: [], fingerprint: [] });
      languages.zh.chapters.push({ chapter: chineseChapter, ast: null, evidenceIds: [], externalHrefs: [], normalizedHrefs: [], anchorIds: [], fingerprint: [] });
      continue;
    }
    const records = {};
    for (const [lang, chapter] of [["en", englishChapter], ["zh", chineseChapter]]) {
      const path = sourcePath(root, lang, chapter);
      assert(existsSync(path), `${lang}/${chapter.id}-${chapter.slug}: ${chapter.status} chapter is missing its source fragment`);
      const ast = parseFragment(readUtf8(path, `${lang}/${chapter.id}-${chapter.slug}`), `${lang}/${chapter.id}-${chapter.slug}`);
      const evidenceIds = evidenceSequence(ast);
      for (const id of evidenceIds) assert(evidenceById.has(id), `${lang}/${chapter.id}-${chapter.slug}: unknown evidence id ${id}`);
      const externalHrefs = externalHrefSequence(ast, `${lang}/${chapter.id}-${chapter.slug}`);
      const anchorIds = anchorIdSequence(ast);
      const anchorSet = new Set(anchorIds);
      const normalizedHrefs = hrefSequence(ast, `${lang}/${chapter.id}-${chapter.slug}`).map((href) => normalizeHref(href, `${lang}/${chapter.id}-${chapter.slug}`, slugSet, anchorSet));
      records[lang] = { chapter, ast, evidenceIds, externalHrefs, normalizedHrefs, anchorIds, fingerprint: semanticFingerprint(ast) };
      languages[lang].chapters.push(records[lang]);
    }
    assertBilingualChapterParity(records.en, records.zh);
  }
  for (const lang of LANGUAGES) {
    const ids = new Set(manifests[lang].chapters.map((chapter) => `chapter-${chapter.id}-${chapter.slug}`));
    for (const record of languages[lang].chapters) {
      for (const id of record.anchorIds) {
        assert(!ids.has(id), `${lang}: duplicate report anchor id ${id}`);
        ids.add(id);
      }
    }
  }
  const sourceValidation = validatePinnedSources(baseline, catalog, sourceCheck, pinnedSourceRoot);
  return { repoRoot: root, baseline, catalog, evidenceById, inventory, languages, sourceValidation };
}
