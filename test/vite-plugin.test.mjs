import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import vitePluginWalleCOS from '../index.js'

async function createViteRootWithRollup(version) {
  const root = await mkdtemp(path.join(tmpdir(), 'walle-vite-rollup-'))
  const viteDir = path.join(root, 'node_modules', 'vite')
  const rollupDir = path.join(root, 'node_modules', 'rollup')
  await mkdir(viteDir, { recursive: true })
  await mkdir(path.join(rollupDir, 'dist'), { recursive: true })
  await writeFile(path.join(viteDir, 'package.json'), JSON.stringify({ main: 'index.js' }))
  await writeFile(path.join(viteDir, 'index.js'), '')
  await writeFile(path.join(rollupDir, 'package.json'), JSON.stringify({ version, main: 'dist/rollup.js' }))
  await writeFile(path.join(rollupDir, 'dist', 'rollup.js'), '')
  return root
}

test('resolves relative build output from the Vite root', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'walle-vite-root-'))
  const outDir = path.join(root, 'dist')
  const logs = []
  const originalLog = console.log
  console.log = (...args) => logs.push(args.map(String).join(' '))

  try {
    await mkdir(outDir)
    await writeFile(path.join(outDir, 'asset.js'), 'export default 1')
    const plugin = vitePluginWalleCOS({
      bucket: 'test-1234567890',
      region: 'ap-beijing',
      test: true
    })
    plugin.configResolved({
      root,
      base: 'https://static.example.com/app/',
      build: { outDir: 'dist' }
    })
    const closeBundle = plugin.closeBundle
    await (typeof closeBundle === 'function' ? closeBundle() : closeBundle.handler())

    assert.ok(logs.some(line => line.includes('asset.js')), 'relative outDir was not scanned from config.root')
  } finally {
    console.log = originalLog
    await rm(root, { recursive: true, force: true })
  }
})

test('uses sequential closeBundle hooks with Rollup 3 and newer', async () => {
  const root = await createViteRootWithRollup('3.0.0')
  const plugin = vitePluginWalleCOS()

  try {
    plugin.configResolved({ root, base: '/', build: { outDir: 'dist' } })
    assert.equal(typeof plugin.closeBundle, 'object')
    assert.equal(plugin.closeBundle.order, 'post')
    assert.equal(plugin.closeBundle.sequential, true)
    assert.equal(typeof plugin.closeBundle.handler, 'function')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('reports a missing Rollup installation once per project root', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'walle-vite-no-rollup-'))
  const warnings = []
  const originalWarn = console.warn
  console.warn = (...args) => warnings.push(args.map(String).join(' '))

  try {
    const plugin = vitePluginWalleCOS()
    plugin.configResolved({ root, base: '/', build: { outDir: 'dist' } })
    plugin.configResolved({ root, base: '/', build: { outDir: 'dist' } })

    assert.equal(warnings.filter(line => line.includes('could not detect Rollup')).length, 1)
  } finally {
    console.warn = originalWarn
    await rm(root, { recursive: true, force: true })
  }
})

test('keeps a function closeBundle hook for Rollup 2 compatibility', async () => {
  const root = await createViteRootWithRollup('2.77.3')
  const plugin = vitePluginWalleCOS()

  try {
    plugin.configResolved({ root, base: '/', build: { outDir: 'dist' } })
    assert.equal(typeof plugin.closeBundle, 'function')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
