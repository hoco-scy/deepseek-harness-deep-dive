import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const analysisRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const upstreamRoot = resolve(process.argv[2] || "/home/scy/Code/deepseek-harness");
const baseline = JSON.parse(readFileSync(join(analysisRoot, "research", "baseline.json"), "utf8"));
const head = execFileSync("git", ["rev-parse", "HEAD"], { cwd: upstreamRoot, encoding: "utf8" }).trim();

if (head !== baseline.commit) {
  throw new Error(`upstream HEAD ${head} does not match pinned baseline ${baseline.commit}`);
}

function walkFiles(directory) {
  let files = [];
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry);
    const stat = statSync(path);
    if (stat.isDirectory()) files = files.concat(walkFiles(path));
    else files.push(path);
  }
  return files;
}

const packagesRoot = join(upstreamRoot, "packages");
const records = [];
for (const group of readdirSync(packagesRoot).sort()) {
  const groupPath = join(packagesRoot, group);
  if (!statSync(groupPath).isDirectory()) continue;
  for (const leaf of readdirSync(groupPath).sort()) {
    const packagePath = join(groupPath, leaf);
    const manifestPath = join(packagePath, "package.json");
    if (!existsSync(manifestPath)) continue;
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    const files = walkFiles(packagePath).map((path) => relative(upstreamRoot, path).replaceAll("\\", "/"));
    const internalDependencies = [
      ...Object.keys(manifest.dependencies || {}),
      ...Object.keys(manifest.peerDependencies || {})
    ].filter((name) => name.startsWith("@deepseek-ai/dsh-")).sort();
    records.push({
      group,
      leaf,
      name: manifest.name,
      description: manifest.description || "",
      path: relative(upstreamRoot, packagePath).replaceAll("\\", "/"),
      private: manifest.private === true,
      internalDependencies,
      sourceFiles: files.filter((path) => /\/src\/.*\.(?:ts|tsx)$/.test(path)).length,
      testFiles: files.filter((path) => /\/tests\/.*\.(?:ts|tsx)$/.test(path)).length,
      hasInvariant: files.some((path) => path.endsWith("/src/invariant.ts")),
      hasReadme: files.some((path) => path.endsWith("/README.md")),
      hasCordisPatch: files.some((path) => path.endsWith("/cordis.patch.yml")),
      dsh: manifest.dsh || null
    });
  }
}

const groups = Object.entries(Object.groupBy(records, (record) => record.group)).map(([name, packages]) => ({
  name,
  packageCount: packages.length,
  sourceFiles: packages.reduce((sum, pkg) => sum + pkg.sourceFiles, 0),
  testFiles: packages.reduce((sum, pkg) => sum + pkg.testFiles, 0)
}));

const snapshot = {
  baseline: baseline.commit,
  generatedBy: "scripts/capture-package-inventory.mjs",
  counts: {
    groups: groups.length,
    packages: records.length,
    sourceFiles: records.reduce((sum, pkg) => sum + pkg.sourceFiles, 0),
    testFiles: records.reduce((sum, pkg) => sum + pkg.testFiles, 0),
    invariantPackages: records.filter((pkg) => pkg.hasInvariant).length,
    patchBundles: records.filter((pkg) => pkg.hasCordisPatch).length
  },
  groups,
  packages: records
};

writeFileSync(join(analysisRoot, "research", "package-inventory.json"), JSON.stringify(snapshot, null, 2) + "\n");
console.log(`captured packages=${snapshot.counts.packages} groups=${snapshot.counts.groups}`);
