import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const rootArg = process.argv.indexOf('--upstream-root')
if (rootArg < 0 || !process.argv[rootArg + 1]) throw new Error('missing --upstream-root')
const root = resolve(process.argv[rootArg + 1])
const load = (relative: string) => import(pathToFileURL(resolve(root, relative)).href)

async function main(): Promise<void> {
  const persistence = await load('scripts/gen-persistence-catalog.ts')
  const cordisScript = await load('scripts/gen-cordis-catalog.ts')
  const cordisGenerator = await load('packages/typert/generator/src/cordis-catalog.ts')

  const durableEvents = persistence.annotateSurface(
    persistence.collectLogEvents(root),
    persistence.collectSurfaceEventTypes(root),
  )
  const { model } = cordisGenerator.projectCordisCatalog(root, cordisScript.CORDIS_CATALOG_POLICY)

  process.stdout.write(JSON.stringify({
    durableEvents,
    liveEvents: model.events,
    hostServices: model.services,
  }))
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
