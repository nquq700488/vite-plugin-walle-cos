import vitePluginWalleCOS = require('vite-plugin-walle-cos')
import type * as EsmTypes from 'vite-plugin-walle-cos' with { 'resolution-mode': 'import' }
import WebpackPluginWalleCOS = require('vite-plugin-walle-cos/webpack')

vitePluginWalleCOS({ bucket: 'test-1234567890', region: 'ap-beijing' })
void vitePluginWalleCOS.requestTemporaryCredentials()
void vitePluginWalleCOS.uploadToCOS({
  base: 'https://static.example.com/',
  options: { bucket: 'test-1234567890', region: 'ap-beijing' }
})
new WebpackPluginWalleCOS({ bucket: 'test-1234567890', region: 'ap-beijing' })
WebpackPluginWalleCOS.WebpackPluginWalleCOS

// The ESM and CommonJS declarations are maintained separately; keep them aligned.
declare const esmOptions: EsmTypes.Options
declare const cjsOptions: vitePluginWalleCOS.Options
const optionsFromEsm: vitePluginWalleCOS.Options = esmOptions
const optionsFromCjs: EsmTypes.Options = cjsOptions
void optionsFromEsm
void optionsFromCjs

declare const esmTemporaryCredentials: EsmTypes.TemporaryCredentialOptions
const temporaryCredentialsFromEsm: vitePluginWalleCOS.TemporaryCredentialOptions = esmTemporaryCredentials
void temporaryCredentialsFromEsm
