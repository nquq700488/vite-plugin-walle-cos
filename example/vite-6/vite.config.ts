import { fileURLToPath, URL } from 'node:url'

import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import vitePluginWalleCOS from 'vite-plugin-walle-cos'
import * as dotenv from 'dotenv'
import path from 'path'
dotenv.config({path: path.resolve(process.cwd(), '.env.local')})

const options = {
  region: 'ap-beijing',
  bucket: 'pingtai-front-test-1313601664',
  temporaryCredentials: {
    endpoint: process.env.COS_CREDENTIAL_ENDPOINT,
    method: 'GET',
    params: {
      channel: process.env.COS_CREDENTIAL_CHANNEL || 'pt-front-kind'
    }
  },
  // enabled: false,
  test: process.env.COS_UPLOAD_TEST === 'true',
  // retry: 3
}

const prod = process.env.NODE_ENV === 'production'



// https://vite.dev/config/
export default defineConfig({
  // base: prod ? 'https://static-fe-test.ledupeiyou.com/path/2025test/' : '', // same with webpack public path
  base: prod ? 'https://foo.com/base/' : '', // same with webpack public path
  plugins: [vue(), vitePluginWalleCOS(options)],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url))
    },
  },
})
