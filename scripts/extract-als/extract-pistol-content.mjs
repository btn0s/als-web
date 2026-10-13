// Freeze the pistol editor bindings and compiled Kismet independently of runtime constants.
// Usage: node extract-pistol-content.mjs <work-dir> <AlsExtract.dll> <abp-graph.json> <out.json>
// work-dir contains stage/ALS -> pinned ALS checkout, as in run.sh.
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
const [work, dll, graphFile, out] = process.argv.slice(2)
const graph = JSON.parse(readFileSync(graphFile, 'utf8'))
const assets = {}
for (const mode of ['PistolTwoHanded', 'PistolOneHanded']) {
  const name = `AB_Als_${mode}`
  const inspection = resolve(work, `${name}-inspect.json`)
  const kismet = resolve(work, `${name}-kismet.json`)
  execFileSync('dotnet', [dll, 'inspect', resolve(work, 'stage'), name, inspection])
  execFileSync('dotnet', [dll, 'inspect-kismet', resolve(work, 'stage', graph.assets[name].assetPath), kismet])
  const exports = JSON.parse(readFileSync(inspection, 'utf8'))
  const compiled = JSON.parse(readFileSync(kismet, 'utf8'))
  // Resolve native calls through the separate CUE4Parse import oracle; remove only
  // serializer bookkeeping. Offsets remain so notify wrappers can be traced.
  function compact(value) {
    if (Array.isArray(value)) return value.map(compact)
    if (!value || typeof value !== 'object') return value
    return Object.fromEntries(Object.entries(value).filter(([field]) =>
      !['ResolvedOwner', 'PropertyType', 'RValuePointer'].includes(field),
    ).map(([field, item]) => [field,
      field === '$type' ? item.split('.').at(-1).split(',')[0]
        : field === 'StackNode' && item < 0
          ? graph.assets[name].imports[-item - 1].objectName : compact(item),
    ]))
  }
  assets[name] = {
    source: compiled.source,
    bindings: exports.flatMap((entry) => {
      const bindings = entry.Properties?.PropertyBindings
      if (!bindings?.length) return []
      return [{ node: entry.Outer.ObjectName, bindings: Object.fromEntries(
        bindings.map(({ Key, Value }) => [Key, Value.PropertyPath]),
      ) }]
    }),
    functions: compact(compiled.functions),
  }
}
writeFileSync(out, `${JSON.stringify({ schemaVersion: 1, assets }, null, 2)}\n`)
