import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import ts from 'typescript'

test('root TypeScript configuration emits an executable server module graph', async () => {
  const root = resolve(import.meta.dirname, '..')
  const output = await mkdtemp(join(tmpdir(), 'roadster-runtime-'))
  try {
    const config = ts.readConfigFile(join(root, 'tsconfig.json'), ts.sys.readFile)
    assert.equal(config.error, undefined)
    const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, root)
    const program = ts.createProgram([join(root, 'api/leaderboard.ts')], {
      ...parsed.options, noEmit: false, rootDir: root, outDir: output,
    })
    const diagnostics = ts.getPreEmitDiagnostics(program)
    assert.equal(diagnostics.length, 0, ts.formatDiagnosticsWithColorAndContext(diagnostics, {
      getCurrentDirectory: () => root, getCanonicalFileName: path => path, getNewLine: () => '\n',
    }))
    assert.equal(program.emit().emitSkipped, false)
    await writeFile(join(output, 'package.json'), JSON.stringify({ type: 'module' }))
    await symlink(join(root, 'node_modules'), join(output, 'node_modules'), 'dir')
    const api = await import(pathToFileURL(join(output, 'api/leaderboard.js')).href)
    const response = await api.configuredHandler({})(new Request('https://game.example/api/leaderboard'))
    assert.equal(response.status, 503)
  } finally {
    await rm(output, { recursive: true, force: true })
  }
})
