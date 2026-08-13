#!/usr/bin/env node

import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url))
function argsOf(argv) {
  const args = new Map()
  for (let i = 0; i < argv.length; i += 2) {
    const token = argv[i]
    const value = argv[i + 1]
    if (!token?.startsWith('--') || !value || value.startsWith('--')) throw new Error(`invalid argument pair at ${token ?? '<end>'}`)
    args.set(token.slice(2), value)
  }
  return args
}

const args = argsOf(process.argv.slice(2))
const outputRoot = resolve(args.get('output-root') ?? resolve(SCRIPT_DIR, '..'))
const analysisRoot = resolve(args.get('analysis-root') ?? outputRoot)
const analysisGlossaryPath = resolve(analysisRoot, 'research/glossary.json')
const bundledGlossaryPath = resolve(SCRIPT_DIR, '..', 'research/glossary.json')
const glossaryPath = resolve(args.get('glossary') ?? (existsSync(analysisGlossaryPath) ? analysisGlossaryPath : bundledGlossaryPath))
const assert = (condition, message) => { if (!condition) throw new Error(message) }
const readAt = (root, relative) => readFileSync(resolve(root, relative), 'utf8')
const outputText = relative => readAt(outputRoot, relative)
const outputJson = relative => JSON.parse(outputText(relative))
const inputText = {
  catalog: readAt(analysisRoot, 'evidence/catalog.json'),
  inventory: readAt(analysisRoot, 'research/package-inventory.json'),
  manifestEn: readAt(analysisRoot, 'content/chapters.en.json'),
  manifestZh: readAt(analysisRoot, 'content/chapters.json'),
  glossary: readFileSync(glossaryPath, 'utf8'),
}
const sha256 = value => createHash('sha256').update(value).digest('hex')
const sortedUnique = values => [...new Set(values)].sort()
const same = (actual, expected, label) => assert(JSON.stringify(actual) === JSON.stringify(expected), `${label} is stale`)
const unique = (values, label) => assert(new Set(values).size === values.length, `duplicate ${label}`)
const esc = value => String(value ?? '')
  .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;').replaceAll("'", '&#39;')
const pct = (part, total) => total === 0 ? '0.0%' : `${(100 * part / total).toFixed(1)}%`

const catalog = JSON.parse(inputText.catalog)
const inventory = JSON.parse(inputText.inventory)
const enManifest = JSON.parse(inputText.manifestEn)
const zhManifest = JSON.parse(inputText.manifestZh)
const glossary = JSON.parse(inputText.glossary)
const coverage = outputJson('research/evidence-coverage.json')
const sourceIndex = outputJson('research/source-index.json')
const evidenceManifest = outputJson('evidence/35-glossary-evidence.json')
const en = outputText('content/en/35-glossary-evidence.html')
const zh = outputText('content/35-glossary-evidence.html')
const baseline = glossary.baseline

assert(catalog.baseline === baseline && inventory.baseline === baseline, 'live input baseline mismatch')
for (const asset of [coverage, sourceIndex, evidenceManifest]) assert(asset.baseline === baseline, 'generated asset baseline mismatch')
assert(outputText('research/evidence-coverage.json') === outputText('docs/assets/evidence-coverage.json'), 'coverage public copy drift')
assert(outputText('research/source-index.json') === outputText('docs/assets/source-index.json'), 'source-index public copy drift')
assert(inputText.glossary === outputText('docs/assets/glossary.json'), 'glossary public copy drift')

// Recompute the exact eligible bilingual evidence stream from live manifests
// and fragments. This is the no-upstream-checkout freshness gate used by the
// ordinary analysis-site check command.
assert(enManifest.chapters.length === zhManifest.chapters.length, 'live bilingual manifest count mismatch')
const chapters = enManifest.chapters.map((enChapter, index) => {
  const zhChapter = zhManifest.chapters[index]
  assert(enChapter.id === zhChapter.id && enChapter.slug === zhChapter.slug && enChapter.status === zhChapter.status,
    `live bilingual manifest mismatch at ${enChapter.id}`)
  return { id: enChapter.id, slug: enChapter.slug, status: enChapter.status, title: { en: enChapter.title, zh: zhChapter.title } }
})
const catalogById = new Map(catalog.items.map(item => [item.id, item]))
unique(catalog.items.map(item => item.id), 'live catalog evidence ID')
const extractEvidence = html => [...html.matchAll(/<evidence\s+id=["']([^"']+)["']\s*><\/evidence>/g)].map(match => match[1])
const chapterStates = []
for (const chapter of chapters.filter(chapter => Number(chapter.id) <= 34)) {
  const enPath = resolve(analysisRoot, `content/en/${chapter.id}-${chapter.slug}.html`)
  const zhPath = resolve(analysisRoot, `content/${chapter.id}-${chapter.slug}.html`)
  const hasEn = existsSync(enPath)
  const hasZh = existsSync(zhPath)
  let evidenceIds = []
  if (hasEn && hasZh) {
    const enIds = extractEvidence(readFileSync(enPath, 'utf8'))
    const zhIds = extractEvidence(readFileSync(zhPath, 'utf8'))
    same(enIds, zhIds, `chapter ${chapter.id} bilingual evidence sequence`)
    for (const id of enIds) assert(catalogById.has(id), `chapter ${chapter.id}: unknown live evidence ${id}`)
    evidenceIds = enIds
  }
  chapterStates.push({
    ...chapter,
    hasEn,
    hasZh,
    evidenceIds,
    publishedSubstantive: chapter.status !== 'queued' && hasEn && hasZh,
    verified: chapter.status === 'verified' && hasEn && hasZh,
  })
}

function corpusStats(name, predicate) {
  const selected = chapterStates.filter(predicate)
  const counts = new Map(catalog.items.map(item => [item.id, 0]))
  const citationChapters = new Map(catalog.items.map(item => [item.id, []]))
  for (const chapter of selected) {
    for (const id of chapter.evidenceIds) counts.set(id, counts.get(id) + 1)
    for (const id of new Set(chapter.evidenceIds)) citationChapters.get(id).push(chapter.id)
  }
  const cited = [...counts].filter(([, count]) => count > 0)
  const occurrences = [...counts.values()].reduce((sum, count) => sum + count, 0)
  const kindReach = sortedUnique(catalog.items.map(item => item.kind)).map(kind => {
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
    kindReach,
    occurrenceCountByEvidence: Object.fromEntries([...counts].filter(([, count]) => count > 0)),
    citationChaptersByEvidence: Object.fromEntries([...citationChapters].filter(([, ids]) => ids.length > 0)),
  }
}

const expectedChapterRows = chapterStates.map(({ evidenceIds, ...state }) => ({
  ...state,
  evidenceIds,
  evidenceOccurrences: evidenceIds.length,
}))
const eligibleEvidenceState = chapterStates.map(chapter => ({
  id: chapter.id,
  slug: chapter.slug,
  status: chapter.status,
  hasEn: chapter.hasEn,
  hasZh: chapter.hasZh,
  evidenceIds: chapter.evidenceIds,
}))
const expectedCoverageDigests = {
  catalog: sha256(inputText.catalog),
  inventory: sha256(inputText.inventory),
  manifestEn: sha256(inputText.manifestEn),
  manifestZh: sha256(inputText.manifestZh),
  glossary: sha256(inputText.glossary),
  eligibleEvidenceState: sha256(JSON.stringify(eligibleEvidenceState)),
}
same(coverage.inputDigests, expectedCoverageDigests, 'coverage input digest set')
same(coverage.chapters, expectedChapterRows, 'coverage eligible chapter state and evidence sequences')
same(coverage.corpora.publishedSubstantive, corpusStats('published-substantive', chapter => chapter.publishedSubstantive), 'published-substantive corpus')
same(coverage.corpora.verified, corpusStats('verified', chapter => chapter.verified), 'verified corpus')
assert(coverage.definition.excludedChapterIds.includes('35') && !coverage.chapters.some(chapter => chapter.id === '35'),
  'chapter 35 leaked into coverage')

// Recompute package ownership for every live catalog path. Longest exact path
// boundary wins; unmatched repository files stay in explicit zones.
const packagePaths = [...inventory.packages].sort((a, b) => b.path.length - a.path.length || a.path.localeCompare(b.path))
const packageForPath = path => packagePaths.find(pkg => path === pkg.path || path.startsWith(`${pkg.path}/`)) ?? null
function zoneForPath(path) {
  const first = path.split('/')[0]
  if (path.startsWith('packages/')) return 'packages-unmatched'
  if (['apps', 'docs', 'examples', 'python', 'scripts', '.agents', '.github'].includes(first)) return first
  if (!path.includes('/')) return 'repository-root'
  return `other:${first}`
}
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
const expectedPackages = [...inventory.packages].sort((a, b) => a.path.localeCompare(b.path)).map(pkg => {
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
const expectedZones = sortedUnique([...pathMap.values()].filter(record => !record.packagePath).map(record => record.repositoryZone)).map(zone => {
  const paths = [...pathMap.values()].filter(record => record.repositoryZone === zone)
  return { zone, catalogPaths: paths.length, evidenceIds: paths.flatMap(record => record.evidenceIds).sort() }
})
const expectedPaths = [...pathMap.values()].sort((a, b) => a.path.localeCompare(b.path))
same(sourceIndex.packages, expectedPackages, 'source-index package identities and catalog ownership')
same(sourceIndex.repositoryZones, expectedZones, 'source-index repository-zone ownership')
same(sourceIndex.paths, expectedPaths, 'source-index catalog path identities and ownership')
assert(sourceIndex.inputDigests.catalog === sha256(inputText.catalog), 'source-index catalog input is stale')
assert(sourceIndex.inputDigests.inventory === sha256(inputText.inventory), 'source-index inventory input is stale')
assert(sourceIndex.inputDigests.glossary === sha256(inputText.glossary), 'source-index glossary input is stale')

unique(glossary.terms.map(term => term.id), 'glossary ID')
unique(sourceIndex.symbols.documentedTypeEquivalence.map(symbol => symbol.identity), 'documented symbol identity')
unique(sourceIndex.events.durableSessionLog.map(event => event.name), 'durable event')
unique(sourceIndex.events.liveCordisHostBus.map(event => event.name), 'live host event')
unique(sourceIndex.services.cordisHost.map(service => service.key), 'host service key')
assert(sourceIndex.counts.packages === expectedPackages.length, 'package count mismatch')
assert(sourceIndex.counts.repositoryZones === expectedZones.length, 'repository-zone count mismatch')
assert(sourceIndex.counts.catalogPaths === expectedPaths.length, 'catalog-path count mismatch')
assert(sourceIndex.counts.documentedSymbols === sourceIndex.symbols.documentedTypeEquivalence.length, 'symbol count mismatch')
assert(sourceIndex.counts.durableSessionEvents === sourceIndex.events.durableSessionLog.length, 'durable-event count mismatch')
assert(sourceIndex.counts.liveHostEvents === sourceIndex.events.liveCordisHostBus.length, 'live-event count mismatch')
assert(sourceIndex.counts.hostServices === sourceIndex.services.cordisHost.length, 'host-service count mismatch')

const tagShape = html => [...html.matchAll(/<\/?([a-z][a-z0-9-]*)\b/gi)]
  .map(match => match[0].startsWith('</') ? `/${match[1]}` : match[1]).join('|')
assert(tagShape(en) === tagShape(zh), 'bilingual fragment structure mismatch')
assert(!/<evidence\b/i.test(en) && !/<evidence\b/i.test(zh), 'chapter 35 contains self-citation tags')
assert(!/\[object Object\]/.test(en + zh), 'unrendered object leaked into fragments')
const forbidden = new RegExp([
  ['insight', 'flow'].join('[\\s_-]*'),
  ['go', 'claw'].join(''),
  ['/home', 'scy'].join('/'),
  ['cy', 'shen@'].join('_'),
  ['next', 'level', 'builder'].join(''),
].join('|'), 'i')
assert(!forbidden.test(en + zh), 'private identifier leaked into fragments')

for (const term of glossary.terms) {
  assert(en.includes(`id="term-${term.id}"`) && zh.includes(`id="term-${term.id}"`), `${term.id}: missing bilingual term anchor`)
  assert(en.includes(esc(term.label.en)) && en.includes(esc(term.definition.en)), `${term.id}: stale English glossary rendering`)
  assert(zh.includes(esc(term.label.zh)) && zh.includes(esc(term.definition.zh)), `${term.id}: stale Chinese glossary rendering`)
}
const expectedEvidenceOrder = sortedUnique(catalog.items.map(item => item.kind))
  .flatMap(kind => catalog.items.filter(item => item.kind === kind).sort((a, b) => a.id.localeCompare(b.id)).map(item => item.id))
const enEvidenceAnchors = [...en.matchAll(/id="evidence-([A-Z0-9-]+)"/g)].map(match => match[1])
const zhEvidenceAnchors = [...zh.matchAll(/id="evidence-([A-Z0-9-]+)"/g)].map(match => match[1])
same(enEvidenceAnchors, expectedEvidenceOrder, 'English full evidence catalog identity/order')
same(zhEvidenceAnchors, expectedEvidenceOrder, 'Chinese full evidence catalog identity/order')
assert(evidenceManifest.items.length === 0 && Object.keys(evidenceManifest.usage).length === 0,
  'chapter 35 evidence manifest must remain empty')

console.log(JSON.stringify({
  baseline,
  glossaryTerms: glossary.terms.length,
  catalogItems: catalog.items.length,
  publishedSubstantiveChapters: coverage.corpora.publishedSubstantive.chapterCount,
  verifiedChapters: coverage.corpora.verified.chapterCount,
  packagePaths: sourceIndex.packages.length,
  catalogPaths: sourceIndex.paths.length,
  documentedSymbols: sourceIndex.symbols.documentedTypeEquivalence.length,
  durableSessionEvents: sourceIndex.events.durableSessionLog.length,
  liveHostEvents: sourceIndex.events.liveCordisHostBus.length,
  hostServices: sourceIndex.services.cordisHost.length,
  freshness: 'pass',
  checks: 'pass',
}, null, 2))
