'use strict'

const assert = require('node:assert/strict')
const { mkdtemp, rm, writeFile } = require('node:fs/promises')
const { tmpdir } = require('node:os')
const path = require('node:path')
const test = require('node:test')
const WebpackPluginWalleCOS = require('../webpack.cjs')

async function runAfterEmit({ outDir, mode = 'production', watchMode = false, assets = {} }) {
  let afterEmit
  const compiler = {
    options: { mode, output: {} },
    watchMode,
    hooks: {
      afterEmit: {
        tapPromise(_name, handler) {
          afterEmit = handler
        }
      }
    }
  }
  const plugin = new WebpackPluginWalleCOS({
    bucket: 'test-1234567890',
    region: 'ap-beijing',
    test: true
  })
  const logs = []
  const originalLog = console.log
  console.log = (...args) => logs.push(args.map(String).join(' '))

  try {
    plugin.apply(compiler)
    await afterEmit({
      assets,
      outputOptions: {
        path: outDir,
        publicPath: 'https://static.example.com/app/'
      }
    })
  } finally {
    console.log = originalLog
  }

  return logs
}

function uploadLines(logs) {
  return logs.filter(line => line.includes('test upload path:'))
}

function skipLines(logs) {
  return logs.filter(line => line.includes('skipping COS upload'))
}

async function withOutputDir(run) {
  const outDir = await mkdtemp(path.join(tmpdir(), 'walle-webpack-plugin-'))

  try {
    await run(outDir)
  } finally {
    await rm(outDir, { recursive: true, force: true })
  }
}

test('does not upload development or watch compilations', async () => {
  await withOutputDir(async outDir => {
    await writeFile(path.join(outDir, 'stale.js'), 'stale')

    const developmentLogs = await runAfterEmit({
      outDir,
      mode: 'development',
      assets: { 'dev.js': {} }
    })
    const watchLogs = await runAfterEmit({
      outDir,
      watchMode: true,
      assets: { 'watch.js': {} }
    })

    assert.deepEqual(uploadLines(developmentLogs), [])
    assert.deepEqual(uploadLines(watchLogs), [])
    assert.equal(skipLines(developmentLogs).length, 1)
    assert.equal(skipLines(watchLogs).length, 1)
  })
})

test('uploads when the compilation is not a development build', async () => {
  await withOutputDir(async outDir => {
    await writeFile(path.join(outDir, 'none.js'), 'none')

    const uploads = uploadLines(await runAfterEmit({
      outDir,
      mode: 'none',
      assets: { 'none.js': {} }
    }))

    assert.equal(uploads.length, 1)
    assert.match(uploads[0], /none\.js/)
  })
})

test('uploads only assets from the current compilation', async () => {
  await withOutputDir(async outDir => {
    await writeFile(path.join(outDir, 'current.js'), 'current')
    await writeFile(path.join(outDir, 'stale.js'), 'stale')

    const uploads = uploadLines(await runAfterEmit({
      outDir,
      assets: { 'current.js': {} }
    }))

    assert.equal(uploads.length, 1)
    assert.match(uploads[0], /current\.js/)
    assert.ok(!uploads.some(line => line.includes('stale.js')))
  })
})

test('ignores selected HTML assets without reporting them as missing', async () => {
  await withOutputDir(async outDir => {
    await writeFile(path.join(outDir, 'index.html'), '<!doctype html>')
    await writeFile(path.join(outDir, 'app.js'), 'app')

    const uploads = uploadLines(await runAfterEmit({
      outDir,
      assets: { 'index.html': {}, 'app.js': {} }
    }))

    assert.equal(uploads.length, 1)
    assert.match(uploads[0], /app\.js/)
  })
})

test('fails when Webpack assets are missing from the configured output directory', async () => {
  await withOutputDir(async outDir => {
    await writeFile(path.join(outDir, 'stale.js'), 'stale')

    await assert.rejects(
      runAfterEmit({
        outDir,
        assets: { 'missing.js': {} }
      }),
      /selected upload files were not found/
    )
  })
})
