'use strict'

const pluginName = 'vite-plugin-walle-cos'

class WebpackPluginWalleCOS {
  constructor(options = {}) {
    this.options = options
  }

  apply(compiler) {
    if (this.options.enabled === false) {
      return
    }

    let skipReported = false
    const upload = async compilation => {
      const mode = compiler.options.mode || 'production'
      if (compiler.watchMode || mode === 'development') {
        if (!skipReported) {
          skipReported = true
          console.log(
            `[${pluginName}] skipping COS upload: ${compiler.watchMode ? 'watch mode' : 'development mode'} builds are not uploaded`
          )
        }
        return
      }

      const outputOptions = compilation.outputOptions || compiler.options.output || {}
      const outDir = this.options.outDir || outputOptions.path
      const base = this.options.base || outputOptions.publicPath
      const files = Object.keys(compilation.assets || {})
      const { uploadToCOS } = await import('./index.js')

      await uploadToCOS({
        outDir,
        files,
        base,
        options: this.options
      })
    }

    if (compiler.hooks.afterEmit.tapPromise) {
      compiler.hooks.afterEmit.tapPromise(pluginName, upload)
      return
    }

    compiler.hooks.afterEmit.tapAsync(pluginName, (compilation, callback) => {
      upload(compilation).then(() => callback(), callback)
    })
  }
}

module.exports = WebpackPluginWalleCOS
module.exports.default = WebpackPluginWalleCOS
module.exports.WebpackPluginWalleCOS = WebpackPluginWalleCOS
