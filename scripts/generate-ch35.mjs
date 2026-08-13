#!/usr/bin/env node

import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url))
const EXPECTED_CHAPTER = '35'

function argsOf(argv) {
  const args = new Map()
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i]
    if (!token.startsWith('--')) throw new Error(`unexpected argument: ${token}`)
    if (token === '--check') {
      args.set('check', true)
      continue
    }
    const value = argv[i + 1]
    if (!value || value.startsWith('--')) throw new Error(`missing value for ${token}`)
    args.set(token.slice(2), value)
    i += 1
  }
  return args
}

const args = argsOf(process.argv.slice(2))
const analysisRoot = resolve(args.get('analysis-root') ?? process.cwd())
const upstreamRoot = resolve(args.get('upstream-root') ?? resolve(analysisRoot, '..', 'deepseek-harness'))
const outputRoot = resolve(args.get('output-root') ?? analysisRoot)
const analysisGlossaryPath = resolve(analysisRoot, 'research/glossary.json')
const bundledGlossaryPath = resolve(SCRIPT_DIR, '..', 'research/glossary.json')
const glossaryPath = resolve(args.get('glossary') ?? (existsSync(analysisGlossaryPath) ? analysisGlossaryPath : bundledGlossaryPath))
const checkOnly = args.get('check') === true

const assert = (condition, message) => { if (!condition) throw new Error(message) }
const write = (path, value) => {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, value)
}
const posix = value => value.split(sep).join('/')
const sortedUnique = values => [...new Set(values)].sort()
const sha256 = value => createHash('sha256').update(value).digest('hex')
const esc = value => String(value ?? '')
  .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;').replaceAll("'", '&#39;')
const pct = (part, total) => total === 0 ? '0.0%' : `${(100 * part / total).toFixed(1)}%`
const chapterHref = chapter => `${chapter.slug}.html`
function repoFile(relativePath, label) {
  assert(typeof relativePath === 'string' && relativePath.length > 0, `${label}: empty repository path`)
  const absolute = resolve(upstreamRoot, relativePath)
  const rel = posix(relative(upstreamRoot, absolute))
  assert(rel !== '..' && !rel.startsWith('../') && rel === relativePath, `${label}: path escapes or is not normalized: ${relativePath}`)
  assert(existsSync(absolute) && statSync(absolute).isFile(), `${label}: missing file ${relativePath}`)
  return absolute
}

const inputPaths = {
  baseline: resolve(analysisRoot, 'research/baseline.json'),
  catalog: resolve(analysisRoot, 'evidence/catalog.json'),
  inventory: resolve(analysisRoot, 'research/package-inventory.json'),
  manifestEn: resolve(analysisRoot, 'content/chapters.en.json'),
  manifestZh: resolve(analysisRoot, 'content/chapters.json'),
  glossary: glossaryPath,
  typeEquiv: resolve(args.get('type-equiv-manifest') ?? resolve(upstreamRoot, 'scripts/type-equiv.manifest.json')),
}
const inputText = Object.fromEntries(Object.entries(inputPaths).map(([key, path]) => [key, readFileSync(path, 'utf8')]))
const baseline = JSON.parse(inputText.baseline)
const catalog = JSON.parse(inputText.catalog)
const inventory = JSON.parse(inputText.inventory)
const enManifest = JSON.parse(inputText.manifestEn)
const zhManifest = JSON.parse(inputText.manifestZh)
const glossary = JSON.parse(inputText.glossary)
const typeEquiv = JSON.parse(inputText.typeEquiv)

assert(catalog.baseline === baseline.commit, 'evidence catalog baseline mismatch')
assert(inventory.baseline === baseline.commit, 'package inventory baseline mismatch')
assert(glossary.baseline === baseline.commit, 'glossary baseline mismatch')
const upstreamHead = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: upstreamRoot, encoding: 'utf8' }).trim()
assert(upstreamHead === baseline.commit, `upstream checkout ${upstreamHead} does not match ${baseline.commit}`)

assert(enManifest.chapters.length === zhManifest.chapters.length, 'manifest chapter count mismatch')
const chapters = enManifest.chapters.map((en, index) => {
  const zh = zhManifest.chapters[index]
  assert(en.id === zh.id && en.slug === zh.slug && en.status === zh.status, `manifest mismatch at ${en.id}`)
  return { id: en.id, slug: en.slug, status: en.status, title: { en: en.title, zh: zh.title } }
})
const chapterById = new Map(chapters.map(chapter => [chapter.id, chapter]))
assert(chapterById.has(EXPECTED_CHAPTER), 'chapter 35 is missing from manifests')

const catalogById = new Map()
for (const item of catalog.items) {
  assert(!catalogById.has(item.id), `duplicate evidence ID ${item.id}`)
  assert(item.title && item.titleEn && item.supports && item.supportsEn, `${item.id}: incomplete bilingual catalog text`)
  assert(/^[0-9]+(?:-[0-9]+)?$/.test(item.lines), `${item.id}: unsupported line range ${item.lines}`)
  const sourcePath = repoFile(item.path, item.id)
  const [start, end = start] = item.lines.split('-').map(Number)
  const lineCount = readFileSync(sourcePath, 'utf8').split('\n').length
  assert(start > 0 && end >= start && end <= lineCount, `${item.id}: line range exceeds ${item.path}`)
  catalogById.set(item.id, item)
}

const evidenceIds = html => [...html.matchAll(/<evidence\s+id=["']([^"']+)["']\s*><\/evidence>/g)].map(match => match[1])
const chapterStates = []
for (const chapter of chapters.filter(chapter => Number(chapter.id) <= 34)) {
  const enPath = resolve(analysisRoot, `content/en/${chapter.id}-${chapter.slug}.html`)
  const zhPath = resolve(analysisRoot, `content/${chapter.id}-${chapter.slug}.html`)
  const hasEn = existsSync(enPath)
  const hasZh = existsSync(zhPath)
  let ids = []
  if (hasEn && hasZh) {
    const enIds = evidenceIds(readFileSync(enPath, 'utf8'))
    const zhIds = evidenceIds(readFileSync(zhPath, 'utf8'))
    assert(JSON.stringify(enIds) === JSON.stringify(zhIds), `chapter ${chapter.id}: bilingual evidence sequence mismatch`)
    for (const id of enIds) assert(catalogById.has(id), `chapter ${chapter.id}: unknown evidence ${id}`)
    ids = enIds
  }
  chapterStates.push({
    ...chapter,
    hasEn,
    hasZh,
    evidenceIds: ids,
    publishedSubstantive: chapter.status !== 'queued' && hasEn && hasZh,
    verified: chapter.status === 'verified' && hasEn && hasZh,
  })
}

function corpusStats(name, predicate) {
  const selected = chapterStates.filter(predicate)
  const counts = new Map(catalog.items.map(item => [item.id, 0]))
  const citationChapters = new Map(catalog.items.map(item => [item.id, []]))
  for (const chapter of selected) {
    const chapterUnique = new Set(chapter.evidenceIds)
    for (const id of chapter.evidenceIds) counts.set(id, counts.get(id) + 1)
    for (const id of chapterUnique) citationChapters.get(id).push(chapter.id)
  }
  const cited = [...counts].filter(([, count]) => count > 0)
  const occurrences = [...counts.values()].reduce((sum, count) => sum + count, 0)
  const kinds = sortedUnique(catalog.items.map(item => item.kind)).map(kind => {
    const items = catalog.items.filter(item => item.kind === kind)
    const reached = items.filter(item => counts.get(item.id) > 0).length
    return { kind, catalogItems: items.length, citedItems: reached, reach: pct(reached, items.length) }
  })
  const catalogPaths = sortedUnique(catalog.items.map(item => item.path))
  const citedPaths = new Set(catalog.items.filter(item => counts.get(item.id) > 0).map(item => item.path))
  return {
    name,
    chapterIds: selected.map(chapter => chapter.id),
    chapterCount: selected.length,
    catalogItems: catalog.items.length,
    evidenceOccurrences: occurrences,
    uniqueCitedItems: cited.length,
    reusedItems: cited.filter(([, count]) => count > 1).length,
    reuseOccurrences: occurrences - cited.length,
    uncitedItems: catalog.items.length - cited.length,
    catalogReach: pct(cited.length, catalog.items.length),
    catalogPaths: catalogPaths.length,
    citedCatalogPaths: citedPaths.size,
    catalogPathReach: pct(citedPaths.size, catalogPaths.length),
    kindReach: kinds,
    occurrenceCountByEvidence: Object.fromEntries([...counts].filter(([, count]) => count > 0)),
    citationChaptersByEvidence: Object.fromEntries([...citationChapters].filter(([, value]) => value.length > 0)),
  }
}

const published = corpusStats('published-substantive', chapter => chapter.publishedSubstantive)
const verified = corpusStats('verified', chapter => chapter.verified)
const eligibleEvidenceState = chapterStates.map(chapter => ({
  id: chapter.id,
  slug: chapter.slug,
  status: chapter.status,
  hasEn: chapter.hasEn,
  hasZh: chapter.hasZh,
  evidenceIds: chapter.evidenceIds,
}))
const coverage = {
  schemaVersion: 1,
  baseline: baseline.commit,
  inputDigests: {
    catalog: sha256(inputText.catalog),
    inventory: sha256(inputText.inventory),
    manifestEn: sha256(inputText.manifestEn),
    manifestZh: sha256(inputText.manifestZh),
    glossary: sha256(inputText.glossary),
    eligibleEvidenceState: sha256(JSON.stringify(eligibleEvidenceState)),
  },
  definition: {
    eligibleChapterRange: '00-34',
    excludedChapterIds: ['35'],
    localeRule: {
      en: 'English and Chinese evidence occurrence sequences must match; the English sequence is counted once.',
      zh: '中英文证据出现序列必须一致；统计时只计一次英文规范序列。',
    },
    publishedSubstantiveRule: {
      en: 'status != queued and both locale fragments exist',
      zh: 'status != queued，且双语 Fragment 均存在',
    },
    verifiedRule: {
      en: 'status == verified and both locale fragments exist',
      zh: 'status == verified，且双语 Fragment 均存在',
    },
    interpretation: {
      en: 'Catalog reach measures cited catalog IDs only; it is not claim, architecture, package, source-file, or proof-quality coverage.',
      zh: '目录触达只衡量被引用的目录 ID；它不是 Claim、架构、Package、源码文件或证明质量覆盖。',
    },
  },
  chapters: chapterStates.map(({ evidenceIds: ids, ...state }) => ({
    ...state,
    evidenceIds: ids,
    evidenceOccurrences: ids.length,
  })),
  corpora: { publishedSubstantive: published, verified },
}

const packagePaths = [...inventory.packages].sort((a, b) => b.path.length - a.path.length || a.path.localeCompare(b.path))
const packageForPath = path => packagePaths.find(pkg => path === pkg.path || path.startsWith(`${pkg.path}/`)) ?? null
function zoneForPath(path) {
  const first = path.split('/')[0]
  if (path.startsWith('packages/')) return 'packages-unmatched'
  if (['apps', 'docs', 'examples', 'python', 'scripts', '.agents', '.github'].includes(first)) return first
  if (!path.includes('/')) return 'repository-root'
  return `other:${first}`
}

const citationMap = published.citationChaptersByEvidence
const pathMap = new Map()
for (const item of catalog.items) {
  const record = pathMap.get(item.path) ?? { path: item.path, packagePath: null, repositoryZone: null, evidenceIds: [] }
  record.evidenceIds.push(item.id)
  pathMap.set(item.path, record)
}
for (const record of pathMap.values()) {
  const pkg = packageForPath(record.path)
  record.packagePath = pkg?.path ?? null
  record.repositoryZone = pkg ? null : zoneForPath(record.path)
  record.evidenceIds.sort((left, right) => {
    const a = catalogById.get(left); const b = catalogById.get(right)
    return Number(a.lines.split('-')[0]) - Number(b.lines.split('-')[0]) || left.localeCompare(right)
  })
}

const packageRecords = [...inventory.packages]
  .sort((a, b) => a.path.localeCompare(b.path))
  .map(pkg => {
    const paths = [...pathMap.values()].filter(record => record.packagePath === pkg.path)
    return {
      group: pkg.group,
      leaf: pkg.leaf,
      name: pkg.name,
      path: pkg.path,
      private: pkg.private,
      internalDependencies: pkg.internalDependencies,
      sourceFiles: pkg.sourceFiles,
      testFiles: pkg.testFiles,
      hasInvariant: pkg.hasInvariant,
      hasReadme: pkg.hasReadme,
      hasCordisPatch: pkg.hasCordisPatch,
      catalogPaths: paths.length,
      evidenceIds: paths.flatMap(record => record.evidenceIds).sort(),
    }
  })
const repositoryZones = sortedUnique([...pathMap.values()].filter(record => !record.packagePath).map(record => record.repositoryZone))
  .map(zone => {
    const paths = [...pathMap.values()].filter(record => record.repositoryZone === zone)
    return { zone, catalogPaths: paths.length, evidenceIds: paths.flatMap(record => record.evidenceIds).sort() }
  })

for (const entry of typeEquiv.entries) {
  assert(typeof entry.symbol === 'string' && entry.symbol.length > 0, 'type-equivalence entry has no symbol')
  repoFile(entry.source, `type-equivalence ${entry.symbol} source`)
  repoFile(entry.doc, `type-equivalence ${entry.symbol} documentation`)
}
const documentedSymbols = typeEquiv.entries
  .map(entry => ({
    identity: [entry.source, entry.symbol, entry.projection ?? 'complete'].join('::'),
    symbol: entry.symbol,
    projection: entry.projection ?? 'complete',
    source: entry.source,
    doc: entry.doc,
    packagePath: packageForPath(entry.source)?.path ?? null,
    evidenceIds: [...pathMap.values()].find(record => record.path === entry.source)?.evidenceIds ?? [],
  }))
  .sort((a, b) => a.source.localeCompare(b.source) || a.symbol.localeCompare(b.symbol) || a.projection.localeCompare(b.projection))
assert(new Set(documentedSymbols.map(entry => entry.identity)).size === documentedSymbols.length, 'duplicate type-equivalence symbol identity')

const tsx = resolve(upstreamRoot, 'node_modules/.bin/tsx')
assert(existsSync(tsx), `upstream tsx runner missing: ${tsx}`)
const upstreamModelsText = execFileSync(tsx, [resolve(SCRIPT_DIR, 'extract-upstream-models.ts'), '--upstream-root', upstreamRoot], {
  cwd: upstreamRoot,
  encoding: 'utf8',
  maxBuffer: 128 * 1024 * 1024,
})
const upstreamModels = JSON.parse(upstreamModelsText)
const sourceParts = source => {
  const match = /^(.*):(\d+)$/.exec(source)
  assert(match, `unparseable upstream source pointer: ${source}`)
  return { path: match[1], line: Number(match[2]) }
}
const pointerFields = entry => {
  const pointer = sourceParts(entry.source)
  const absolute = repoFile(pointer.path, `upstream model ${entry.source}`)
  const lineCount = readFileSync(absolute, 'utf8').split('\n').length
  assert(pointer.line > 0 && pointer.line <= lineCount, `upstream model pointer exceeds ${pointer.path}: ${pointer.line}/${lineCount}`)
  return {
    sourcePath: pointer.path,
    sourceLine: pointer.line,
    packagePath: packageForPath(pointer.path)?.path ?? null,
    evidenceIds: [...pathMap.values()].find(record => record.path === pointer.path)?.evidenceIds ?? [],
  }
}
const durableEvents = upstreamModels.durableEvents.map(entry => ({
  name: entry.name,
  scope: entry.scope,
  payload: entry.payload,
  surface: entry.surface,
  source: entry.source,
  ...pointerFields(entry),
})).sort((a, b) => a.name.localeCompare(b.name))
const liveEvents = upstreamModels.liveEvents.map(entry => ({
  name: entry.name,
  scope: entry.scope,
  signature: entry.signature,
  mode: entry.mode,
  source: entry.source,
  ...pointerFields(entry),
})).sort((a, b) => a.name.localeCompare(b.name))
const hostServices = upstreamModels.hostServices.map(entry => ({
  key: entry.key,
  type: entry.type,
  abstract: entry.abstract,
  methods: entry.methods.map(method => ({ kind: method.kind ?? null, signature: method.signature })),
  source: entry.source,
  ...pointerFields(entry),
})).sort((a, b) => a.key.localeCompare(b.key))

const sourceIndex = {
  schemaVersion: 1,
  baseline: baseline.commit,
  repository: baseline.repository,
  inputDigests: {
    catalog: sha256(inputText.catalog),
    inventory: sha256(inputText.inventory),
    glossary: sha256(inputText.glossary),
    typeEquivalenceManifest: sha256(inputText.typeEquiv),
    upstreamStructuredModels: sha256(upstreamModelsText),
  },
  universes: {
    packageIndex: {
      en: 'Every package in research/package-inventory.json at the pinned baseline; catalog counts only describe evidence/catalog.json paths.',
      zh: '固定基线 research/package-inventory.json 中的每个 Package；目录计数只描述 evidence/catalog.json 的路径。',
    },
    pathIndex: {
      en: 'Every distinct path in evidence/catalog.json; this is not an inventory of all repository files.',
      zh: 'evidence/catalog.json 中的每个不同路径；这不是仓库全部文件清单。',
    },
    symbolIndex: {
      en: 'Every primary entry in scripts/type-equiv.manifest.json, identified by source + symbol + projection; this is not all exported or declared symbols.',
      zh: 'scripts/type-equiv.manifest.json 中每个按 source + symbol + projection 标识的主条目；这不是全部 Export 或声明。',
    },
    durableEventIndex: {
      en: 'Every repository SessionEventMap member accepted by the upstream persistence-catalog generator; downstream plugin events are outside this universe.',
      zh: '上游 persistence-catalog 生成器接受的每个仓库 SessionEventMap 成员；下游插件事件不在该全集内。',
    },
    liveEventIndex: {
      en: 'Every host-face repository event in the upstream Typert Cordis model; inherited framework and client-face events are outside this universe.',
      zh: '上游 Typert Cordis 模型中的每个 Host Face 仓库事件；继承的框架事件与 Client Face 事件不在该全集内。',
    },
    hostServiceIndex: {
      en: 'Every host-face repository service in the same upstream Typert Cordis model; inherited framework and client-face services are outside this universe.',
      zh: '同一上游 Typert Cordis 模型中的每个 Host Face 仓库 Service；继承的框架 Service 与 Client Face Service 不在该全集内。',
    },
  },
  counts: {
    packages: packageRecords.length,
    repositoryZones: repositoryZones.length,
    catalogPaths: pathMap.size,
    documentedSymbols: documentedSymbols.length,
    durableSessionEvents: durableEvents.length,
    liveHostEvents: liveEvents.length,
    hostServices: hostServices.length,
  },
  packages: packageRecords,
  repositoryZones,
  paths: [...pathMap.values()].sort((a, b) => a.path.localeCompare(b.path)),
  symbols: { documentedTypeEquivalence: documentedSymbols },
  events: { durableSessionLog: durableEvents, liveCordisHostBus: liveEvents },
  services: { cordisHost: hostServices },
}

for (const term of glossary.terms) {
  assert(/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(term.id), `invalid glossary ID ${term.id}`)
  assert(term.label?.en && term.label?.zh && term.definition?.en && term.definition?.zh, `${term.id}: incomplete bilingual glossary record`)
  assert(chapterById.has(term.firstDefinitionChapter), `${term.id}: unknown first-definition chapter`)
  assert(new Set(term.relatedChapters).size === term.relatedChapters.length, `${term.id}: duplicate related chapter`)
  assert(!term.relatedChapters.includes(term.firstDefinitionChapter), `${term.id}: first-definition chapter duplicated in related chapters`)
  assert(new Set(term.evidenceIds).size === term.evidenceIds.length, `${term.id}: duplicate glossary evidence ID`)
  assert(new Set(term.aliases.en).size === term.aliases.en.length, `${term.id}: duplicate English alias`)
  assert(new Set(term.aliases.zh).size === term.aliases.zh.length, `${term.id}: duplicate Chinese alias`)
  for (const id of term.relatedChapters) assert(chapterById.has(id), `${term.id}: unknown related chapter ${id}`)
  for (const id of term.evidenceIds) assert(catalogById.has(id), `${term.id}: unknown evidence ${id}`)
}
assert(new Set(glossary.terms.map(term => term.id)).size === glossary.terms.length, 'duplicate glossary IDs')

const sourceUrl = (path, lines) => {
  const encoded = path.split('/').map(encodeURIComponent).join('/')
  const [start, end = start] = String(lines).split('-')
  return `${baseline.repository}/blob/${baseline.commit}/${encoded}#L${start}-L${end}`
}
const blobUrl = path => `${baseline.repository}/blob/${baseline.commit}/${path.split('/').map(encodeURIComponent).join('/')}`
const pointerUrl = (path, line) => sourceUrl(path, `${line}-${line}`)
const chapterLinks = ids => ids.map(id => {
  const chapter = chapterById.get(id)
  return `<a href="${esc(chapterHref(chapter))}">${esc(id)}</a>`
}).join(', ')

const copy = {
  en: {
    introTitle: 'Conclusion: a reverse-navigation layer over the pinned baseline',
    intro: 'This chapter is an index, not a second narrative. Start with a term, catalog ID, package path, documented symbol, or event name and follow it back to the exact pinned source. Every count below is generated from the current manifests, bilingual fragments, catalog, inventory, and upstream structured models.',
    guideTitle: '1. Reading guide and scope',
    guide: 'Catalog reach counts stable evidence IDs cited by eligible Chapters 00–34. English and Chinese citation sequences must be identical, and each bilingual chapter is counted once. Chapter 35 is always excluded, so rendering the catalog cannot improve its own coverage.',
    glossaryTitle: '2. Bilingual glossary',
    firstDefinition: 'First definition', related: 'Related chapters', evidence: 'Evidence records', aliases: 'Aliases',
    coverageTitle: '3. Evidence catalog reach',
    corpus: 'Corpus', chapters: 'Chapters', occurrences: 'Occurrences', cited: 'Unique IDs cited', uncited: 'Uncited IDs', reach: 'Catalog reach', pathReach: 'Catalog-path reach',
    kind: 'Kind', catalogItems: 'Catalog IDs', reused: 'Reused IDs',
    catalogTitle: '4. Complete evidence catalog',
    catalogNote: 'Universe: every record in evidence/catalog.json. Rows are ordinary links, not citation tags, and therefore do not enter coverage. “First” and “all chapters” use the published-substantive corpus.',
    id: 'ID', source: 'Pinned source', support: 'What this excerpt supports', firstCitation: 'First citation', allCitations: 'All citing chapters', never: 'Not cited in this corpus',
    packageTitle: '5. Package and repository-zone index',
    packageNote: 'Universe: the complete pinned package inventory. Evidence counts refer only to catalog paths matched by an exact package-path boundary; unmatched paths are retained in explicit repository zones.',
    package: 'Package / zone', catalogPaths: 'Catalog paths', evidenceRecords: 'Evidence records', sourceFiles: 'Source files', testFiles: 'Test files',
    pathTitle: '6. Catalog path index',
    pathNote: 'Universe: distinct paths represented by the evidence catalog, not every file in the repository.',
    owner: 'Package or repository zone', ranges: 'Catalog ranges',
    symbolTitle: '7. Documented symbol index',
    symbolNote: 'Universe: primary entries in scripts/type-equiv.manifest.json. Identity is source + symbol + projection. This is intentionally not described as all exports or all declarations.',
    symbol: 'Symbol', projection: 'Projection', documentation: 'Documentation',
    eventTitle: '8. Event and service indexes',
    eventNote: 'The durable Session log and live Cordis bus are different planes and are never combined into one total. Durable rows come from the persistence-catalog generator. Live rows and host services come from the host-face Typert model; client-face and inherited framework APIs are out of scope.',
    durable: 'Durable Session log vocabulary', live: 'Live Cordis host-bus vocabulary', services: 'Cordis host services', mode: 'Mode / surface', signature: 'Payload or signature', service: 'Service', methods: 'Public methods',
    limitsTitle: '9. Limits and reproduction',
    limits: 'These indexes establish deterministic navigation within named structured universes. They do not establish complete repository symbol coverage, complete file coverage, downstream-plugin event coverage, claim coverage, or proof quality. Regeneration fails closed on baseline drift, bilingual citation drift, unknown IDs, invalid source ranges, duplicate identities, or leaked self-citations.',
  },
  zh: {
    introTitle: '结论：固定基线之上的反向导航层',
    intro: '本章是索引，而不是第二套叙事。你可以从术语、目录 ID、Package 路径、已文档化符号或事件名出发，回到精确的固定源码。以下每个数字都由当前 Manifest、双语 Fragment、证据目录、Package Inventory 与上游结构化模型生成。',
    guideTitle: '1. 阅读方法与范围',
    guide: '目录触达率统计合格第 00–34 章引用过的稳定证据 ID。中英文引用序列必须完全一致，每个双语章节只计一次。第 35 章始终排除，因此渲染目录不会抬高自身覆盖数据。',
    glossaryTitle: '2. 双语术语表',
    firstDefinition: '首次定义', related: '相关章节', evidence: '证据记录', aliases: '别名',
    coverageTitle: '3. 证据目录触达',
    corpus: '语料集', chapters: '章节数', occurrences: '引用次数', cited: '已引用唯一 ID', uncited: '未引用 ID', reach: '目录触达率', pathReach: '目录路径触达率',
    kind: '类型', catalogItems: '目录 ID', reused: '重复使用 ID',
    catalogTitle: '4. 完整证据目录',
    catalogNote: '全集：evidence/catalog.json 的每条记录。各行使用普通链接而非引用标签，因此不会进入覆盖统计。“首次”和“全部章节”基于已发布实质内容语料。',
    id: 'ID', source: '固定源码', support: '该摘录支持什么', firstCitation: '首次引用', allCitations: '全部引用章节', never: '该语料未引用',
    packageTitle: '5. Package 与仓库区域索引',
    packageNote: '全集：固定基线的完整 Package Inventory。证据数量只涉及按精确 Package 路径边界匹配的目录路径；未匹配路径保留在显式仓库区域中。',
    package: 'Package / 区域', catalogPaths: '目录路径', evidenceRecords: '证据记录', sourceFiles: '源码文件', testFiles: '测试文件',
    pathTitle: '6. 目录路径索引',
    pathNote: '全集：证据目录中出现的所有不同路径，而不是仓库中的每个文件。',
    owner: 'Package 或仓库区域', ranges: '目录行号范围',
    symbolTitle: '7. 已文档化符号索引',
    symbolNote: '全集：scripts/type-equiv.manifest.json 中的主条目，身份为 source + symbol + projection。本索引刻意不称为全部 Export 或全部声明。',
    symbol: '符号', projection: '投影', documentation: '文档',
    eventTitle: '8. 事件与服务索引',
    eventNote: '持久化 Session 日志与实时 Cordis 总线是两个不同平面，绝不合并为一个总数。持久化行来自 persistence-catalog 生成器；实时行和 Host Service 来自 Host Face Typert 模型。Client Face 与继承的框架 API 不在范围内。',
    durable: '持久化 Session 日志词汇', live: '实时 Cordis Host 总线词汇', services: 'Cordis Host Service', mode: '模式 / Surface', signature: '负载或签名', service: 'Service', methods: '公开方法',
    limitsTitle: '9. 限制与复现',
    limits: '这些索引只在具名结构化全集内提供确定性导航。它们不证明仓库符号全覆盖、文件全覆盖、下游插件事件覆盖、Claim 覆盖或证明质量。若基线漂移、双语引用漂移、ID 未知、源码行号无效、身份重复或出现自引污染，重新生成会失败。',
  },
}

function table(headers, rows) {
  return `<div class="table-scroll"><table><thead><tr>${headers.map(header => `<th>${header}</th>`).join('')}</tr></thead><tbody>${rows.map(row => `<tr>${row.map(cell => `<td>${cell}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`
}

function render(locale) {
  const t = copy[locale]
  const glossaryRows = [...glossary.terms].sort((a, b) => a.id.localeCompare(b.id)).map(term => [
    `<strong id="term-${esc(term.id)}">${esc(term.label[locale])}</strong><br><code>${esc(term.id)}</code>`,
    `<p>${esc(term.definition[locale])}</p><small>${esc(t.aliases)}: ${esc(term.aliases[locale].join(', ') || '—')}</small>`,
    `${esc(t.firstDefinition)}: ${chapterLinks([term.firstDefinitionChapter])}<br>${esc(t.related)}: ${chapterLinks(term.relatedChapters)}<br>${esc(t.evidence)}: ${term.evidenceIds.length ? term.evidenceIds.map(id => `<a href="#evidence-${esc(id)}"><code>${esc(id)}</code></a>`).join(', ') : '—'}`,
  ])
  const corpusRows = [published, verified].map(corpus => [
    `<code>${esc(corpus.name)}</code>`, corpus.chapterCount, corpus.evidenceOccurrences, corpus.uniqueCitedItems,
    corpus.uncitedItems, corpus.catalogReach, corpus.catalogPathReach,
  ])
  const kindRows = published.kindReach.map(row => [esc(row.kind), row.catalogItems, row.citedItems, row.reach])
  const byKind = sortedUnique(catalog.items.map(item => item.kind)).map(kind => {
    const rows = catalog.items.filter(item => item.kind === kind).sort((a, b) => a.id.localeCompare(b.id)).map(item => {
      const citations = citationMap[item.id] ?? []
      const title = locale === 'en' ? item.titleEn : item.title
      const support = locale === 'en' ? item.supportsEn : item.supports
      return [
        `<code id="evidence-${esc(item.id)}">${esc(item.id)}</code><br>${esc(title)}`,
        `<a href="${esc(sourceUrl(item.path, item.lines))}"><code>${esc(item.path)}:${esc(item.lines)}</code></a>`,
        esc(support),
        citations.length ? chapterLinks([citations[0]]) : esc(t.never),
        citations.length ? chapterLinks(citations) : '—',
      ]
    })
    return `<details class="index-group"><summary><code>${esc(kind)}</code> · ${rows.length}</summary>${table([t.id, t.source, t.support, t.firstCitation, t.allCitations], rows)}</details>`
  }).join('')
  const packageRows = packageRecords.map(pkg => [
    `<code>${esc(pkg.path)}</code><br>${esc(pkg.name)}`,
    pkg.catalogPaths,
    pkg.evidenceIds.length,
    pkg.sourceFiles,
    pkg.testFiles,
  ])
  const zoneRows = repositoryZones.map(zone => [`<code>${esc(zone.zone)}</code>`, zone.catalogPaths, zone.evidenceIds.length, '—', '—'])
  const pathGroups = [...pathMap.values()].sort((a, b) => a.path.localeCompare(b.path)).map(record => {
    const ranges = record.evidenceIds.map(id => {
      const item = catalogById.get(id)
      return `<a href="#evidence-${esc(id)}"><code>${esc(item.lines)} · ${esc(id)}</code></a>`
    }).join('<br>')
    return [`<code>${esc(record.path)}</code>`, `<code>${esc(record.packagePath ?? record.repositoryZone)}</code>`, ranges]
  })
  const symbolRows = documentedSymbols.map(item => [
    `<code>${esc(item.symbol)}</code>`, `<code>${esc(item.projection)}</code>`,
    `<a href="${esc(blobUrl(item.source))}"><code>${esc(item.source)}</code></a>`,
    `<a href="${esc(blobUrl(item.doc))}"><code>${esc(item.doc)}</code></a>`,
  ])
  const durableRows = durableEvents.map(item => [
    `<code>${esc(item.name)}</code>`, item.surface ? 'surface' : 'log-only', `<code>${esc(item.payload)}</code>`,
    `<a href="${esc(pointerUrl(item.sourcePath, item.sourceLine))}"><code>${esc(item.source)}</code></a>`,
  ])
  const liveRows = liveEvents.map(item => [
    `<code>${esc(item.name)}</code>`, `<code>${esc(item.mode)}</code>`, `<code>${esc(item.signature)}</code>`,
    `<a href="${esc(pointerUrl(item.sourcePath, item.sourceLine))}"><code>${esc(item.source)}</code></a>`,
  ])
  const serviceRows = hostServices.map(item => [
    `<code>${esc(item.key)}</code><br>${esc(item.type)}`, item.abstract ? 'abstract' : 'concrete',
    item.methods.map(method => `<code>${esc(method.signature)}</code>`).join('<br>'),
    `<a href="${esc(pointerUrl(item.sourcePath, item.sourceLine))}"><code>${esc(item.source)}</code></a>`,
  ])
  return `<section id="reverse-index-conclusion"><h2>${esc(t.introTitle)}</h2><div class="thesis"><p>${esc(t.intro)}</p></div></section>
<section id="reading-guide"><h2>${esc(t.guideTitle)}</h2><p>${esc(t.guide)}</p><div class="claim assessment"><div class="claim-label">${locale === 'en' ? 'Interpretation boundary' : '解释边界'}</div><p>${esc(coverage.definition.interpretation[locale])}</p></div></section>
<section id="glossary"><h2>${esc(t.glossaryTitle)} · ${glossary.terms.length}</h2>${table([t.symbol, locale === 'en' ? 'Definition' : '定义', locale === 'en' ? 'Navigation' : '导航'], glossaryRows)}</section>
<section id="evidence-coverage"><h2>${esc(t.coverageTitle)}</h2>${table([t.corpus, t.chapters, t.occurrences, t.cited, t.uncited, t.reach, t.pathReach], corpusRows)}<h3>${locale === 'en' ? 'Published-substantive reach by catalog kind' : '按目录类型统计的已发布实质内容触达'}</h3>${table([t.kind, t.catalogItems, t.cited, t.reach], kindRows)}<p><strong>${esc(t.reused)}:</strong> ${published.reusedItems}; <strong>${locale === 'en' ? 'reuse occurrences' : '重复引用次数'}:</strong> ${published.reuseOccurrences}.</p></section>
<section id="evidence-catalog"><h2>${esc(t.catalogTitle)} · ${catalog.items.length}</h2><p>${esc(t.catalogNote)}</p>${byKind}</section>
<section id="package-index"><h2>${esc(t.packageTitle)} · ${packageRecords.length}</h2><p>${esc(t.packageNote)}</p><details class="index-group"><summary>${locale === 'en' ? 'Packages' : 'Packages'} · ${packageRecords.length}</summary>${table([t.package, t.catalogPaths, t.evidenceRecords, t.sourceFiles, t.testFiles], packageRows)}</details><details class="index-group"><summary>${locale === 'en' ? 'Repository zones' : '仓库区域'} · ${repositoryZones.length}</summary>${table([t.package, t.catalogPaths, t.evidenceRecords, t.sourceFiles, t.testFiles], zoneRows)}</details></section>
<section id="path-index"><h2>${esc(t.pathTitle)} · ${pathMap.size}</h2><p>${esc(t.pathNote)}</p>${table([t.source, t.owner, t.ranges], pathGroups)}</section>
<section id="symbol-index"><h2>${esc(t.symbolTitle)} · ${documentedSymbols.length}</h2><p>${esc(t.symbolNote)}</p>${table([t.symbol, t.projection, t.source, t.documentation], symbolRows)}</section>
<section id="event-index"><h2>${esc(t.eventTitle)}</h2><p>${esc(t.eventNote)}</p><details class="index-group" open><summary>${esc(t.durable)} · ${durableEvents.length}</summary>${table([locale === 'en' ? 'Event' : '事件', t.mode, t.signature, t.source], durableRows)}</details><details class="index-group"><summary>${esc(t.live)} · ${liveEvents.length}</summary>${table([locale === 'en' ? 'Event' : '事件', t.mode, t.signature, t.source], liveRows)}</details><details class="index-group"><summary>${esc(t.services)} · ${hostServices.length}</summary>${table([t.service, locale === 'en' ? 'Class' : '类别', t.methods, t.source], serviceRows)}</details></section>
<section id="limits"><h2>${esc(t.limitsTitle)}</h2><p>${esc(t.limits)}</p><pre><code>node scripts/generate-ch35.mjs --analysis-root . --upstream-root ../deepseek-harness --output-root .</code></pre><ul class="audit-list"><li>${locale === 'en' ? 'Pinned baseline and every catalog path/range verified.' : '已校验固定基线及每条目录路径/行号范围。'}</li><li>${locale === 'en' ? 'Bilingual citation sequences compared before counting.' : '计数前已比较双语引用序列。'}</li><li>${locale === 'en' ? 'Chapter 35 excluded and generated fragments contain no citation tags.' : '第 35 章已排除，生成 Fragment 不含引用标签。'}</li></ul></section>
`
}

const enHtml = render('en')
const zhHtml = render('zh')
const tagShape = html => [...html.matchAll(/<\/?([a-z][a-z0-9-]*)\b/gi)].map(match => match[0].startsWith('</') ? `/${match[1]}` : match[1]).join('|')
assert(tagShape(enHtml) === tagShape(zhHtml), 'generated bilingual HTML structure mismatch')
assert(!/<evidence\b/i.test(enHtml) && !/<evidence\b/i.test(zhHtml), 'chapter 35 generated a self-citation tag')
const forbidden = new RegExp([
  ['insight', 'flow'].join('[\\s_-]*'),
  ['go', 'claw'].join(''),
  ['/home', 'scy'].join('/'),
  ['cy', 'shen@'].join('_'),
  ['next', 'level', 'builder'].join(''),
].join('|'), 'i')
assert(!forbidden.test(enHtml) && !forbidden.test(zhHtml), 'forbidden private identifier in public fragments')

const evidenceManifest = {
  schemaVersion: 1,
  baseline: baseline.commit,
  chapter: '35-glossary-evidence',
  items: [],
  usage: {},
  note: {
    en: 'Chapter 35 renders reverse indexes with ordinary pinned links. It intentionally emits no evidence tags and is excluded from coverage calculations.',
    zh: '第 35 章使用普通固定链接渲染反向索引。它刻意不产生证据标签，并从覆盖统计中排除。',
  },
}

const jsonText = value => `${JSON.stringify(value, null, 2)}\n`
const expectedOutputs = new Map([
  ['research/evidence-coverage.json', jsonText(coverage)],
  ['research/source-index.json', jsonText(sourceIndex)],
  ['docs/assets/glossary.json', inputText.glossary],
  ['docs/assets/evidence-coverage.json', jsonText(coverage)],
  ['docs/assets/source-index.json', jsonText(sourceIndex)],
  ['evidence/35-glossary-evidence.json', jsonText(evidenceManifest)],
  ['content/en/35-glossary-evidence.html', enHtml],
  ['content/35-glossary-evidence.html', zhHtml],
])

if (checkOnly) {
  const stale = []
  for (const [relativePath, expected] of expectedOutputs) {
    const path = resolve(outputRoot, relativePath)
    const actual = existsSync(path) ? readFileSync(path, 'utf8') : null
    if (actual !== expected) stale.push(relativePath)
  }
  assert(stale.length === 0, `stale or missing Chapter 35 output(s): ${stale.join(', ')}. Regenerate without --check.`)
} else {
  for (const [relativePath, content] of expectedOutputs) write(resolve(outputRoot, relativePath), content)
}

console.log(JSON.stringify({
  baseline: baseline.commit,
  outputRoot,
  glossaryTerms: glossary.terms.length,
  publishedSubstantiveChapters: published.chapterCount,
  verifiedChapters: verified.chapterCount,
  catalogItems: catalog.items.length,
  catalogPaths: pathMap.size,
  packages: packageRecords.length,
  documentedSymbols: documentedSymbols.length,
  durableSessionEvents: durableEvents.length,
  liveHostEvents: liveEvents.length,
  hostServices: hostServices.length,
  selfCitationTags: 0,
  mode: checkOnly ? 'check' : 'write',
}, null, 2))
