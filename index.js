import color from 'picocolors'
import { escapePath, globSync } from 'tinyglobby'
import http from 'node:http'
import https from 'node:https'
import { stat } from 'node:fs/promises'
import { createRequire } from 'node:module'
import path from 'node:path'
import { URL } from 'node:url'
import COS from 'cos-nodejs-sdk-v5'

const packName = 'vite-plugin-walle-cos'
let resolveSequentialCloseBundleSupport
const DEFAULT_CREDENTIAL_TIMEOUT = 10000
const DEFAULT_REFRESH_BEFORE_EXPIRES = 60
const PLUGIN_OPTIONS = [
  'base',
  'bucket',
  'enabled',
  'headers',
  'ignore',
  'outDir',
  'overwrite',
  'region',
  'retry',
  'temporaryCredentials',
  'test'
]

function supportsSequentialCloseBundle(root) {
  if (resolveSequentialCloseBundleSupport === undefined) {
    try {
      resolveSequentialCloseBundleSupport = createRequire(import.meta.url)('./rollup-hook.cjs')
    } catch (error) {
      console.warn(
        `[${packName}] could not load the Rollup hook resolver; using the legacy closeBundle hook`,
        error
      )
      resolveSequentialCloseBundleSupport = null
    }
  }

  return resolveSequentialCloseBundleSupport ? resolveSequentialCloseBundleSupport(root) : false
}

function normalizePath(filePath) {
  return filePath.replace(/\\/g, '/')
}

function sleep(timeout) {
  return new Promise(resolve => setTimeout(resolve, timeout))
}

async function retry(fn, retries) {
  let remaining = Math.max(0, Number(retries) || 0)

  while (true) {
    try {
      return await fn()
    } catch (error) {
      if (remaining <= 0) {
        throw error
      }

      remaining -= 1
      console.error(color.red(String(error)))
      console.log(`[${packName}] retry upload after 0.5s, ${remaining} times left`)
      await sleep(500)
    }
  }
}

function normalizeRequestTimeout(value) {
  const timeout = Number(value)
  return Number.isFinite(timeout) && timeout > 0 ? timeout : DEFAULT_CREDENTIAL_TIMEOUT
}

function appendSearchParams(url, params) {
  if (!params) {
    return url
  }

  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) {
      continue
    }

    if (Array.isArray(value)) {
      value.forEach(item => url.searchParams.append(key, String(item)))
    } else {
      url.searchParams.append(key, String(value))
    }
  }

  return url
}

function hasHeader(headers, headerName) {
  return Object.keys(headers).some(key => key.toLowerCase() === headerName)
}

function hasContentType(headers) {
  return hasHeader(headers, 'content-type')
}

function createCredentialRequestBody(method, headers, data) {
  if (data === undefined || method === 'GET' || method === 'HEAD') {
    return undefined
  }
  if (Buffer.isBuffer(data)) {
    return data
  }
  if (ArrayBuffer.isView(data)) {
    return Buffer.from(data.buffer, data.byteOffset, data.byteLength)
  }
  if (data instanceof ArrayBuffer) {
    return Buffer.from(data)
  }
  if (data instanceof URLSearchParams) {
    if (!hasContentType(headers)) {
      headers['content-type'] = 'application/x-www-form-urlencoded;charset=UTF-8'
    }
    return data.toString()
  }
  if (typeof data === 'string') {
    return data
  }

  if (!hasContentType(headers)) {
    headers['content-type'] = 'application/json'
  }
  return JSON.stringify(data)
}

function getCredentialResponseMessage(responseData) {
  let current = responseData

  for (let depth = 0; depth < 3 && current && typeof current === 'object'; depth += 1) {
    const message = [current.message, current.msg, current.error]
      .find(value => typeof value === 'string' && value.trim())
    if (message) {
      return message.replace(/\s+/g, ' ').trim().slice(0, 200)
    }
    current = current.data
  }

  return ''
}

function parseCredentialResponse(response, chunks) {
  if (!response.complete) {
    throw new Error(`[${packName}] temporary credential response was incomplete`)
  }

  const responseText = Buffer.concat(chunks).toString('utf8')
  let responseData = null

  if (responseText) {
    try {
      responseData = JSON.parse(responseText)
    } catch {
      responseData = responseText
    }
  }

  if (!response.statusCode || response.statusCode < 200 || response.statusCode >= 300) {
    const detail = getCredentialResponseMessage(responseData)
    const message = `[${packName}] temporary credential request failed: HTTP ${response.statusCode || 'unknown'}`
    throw new Error(detail ? `${message}: ${detail}` : message)
  }

  return responseData
}

function sendCredentialRequest(transport, requestUrl, requestOptions, requestBody, requestTimeout) {
  return new Promise((resolve, reject) => {
    let settled = false
    let deadline
    const settle = (callback, value) => {
      if (settled) {
        return
      }
      settled = true
      clearTimeout(deadline)
      callback(value)
    }
    const fail = error => settle(reject, error instanceof Error ? error : new Error(String(error)))
    const timeoutError = new Error(`[${packName}] temporary credential request timed out after ${requestTimeout}ms`)
    const request = transport.request(requestUrl, {
      ...requestOptions,
      timeout: requestTimeout
    }, response => {
      const chunks = []
      const responseError = new Error(`[${packName}] temporary credential response was incomplete`)
      response.on('data', chunk => chunks.push(chunk))
      response.on('error', fail)
      response.on('aborted', () => fail(responseError))
      response.on('close', () => {
        if (!response.complete) {
          fail(responseError)
        }
      })
      response.on('end', () => {
        try {
          settle(resolve, parseCredentialResponse(response, chunks))
        } catch (error) {
          fail(error)
        }
      })
    })

    request.on('timeout', () => request.destroy(timeoutError))
    request.on('error', fail)
    if (requestTimeout > 0) {
      deadline = setTimeout(() => request.destroy(timeoutError), requestTimeout)
    }

    if (requestBody !== undefined) {
      request.write(requestBody)
    }
    request.end()
  })
}

async function defaultCredentialRequest({ url, method, params, headers, data, timeout }) {
  const requestUrl = appendSearchParams(new URL(url), params)
  const requestMethod = String(method || 'GET').toUpperCase()
  const requestHeaders = { ...headers }
  const requestTimeout = normalizeRequestTimeout(timeout)
  const requestBody = createCredentialRequestBody(requestMethod, requestHeaders, data)

  if (requestBody !== undefined && !hasHeader(requestHeaders, 'content-length')) {
    const bodyLength = Buffer.isBuffer(requestBody)
      ? requestBody.length
      : Buffer.byteLength(requestBody)
    requestHeaders['content-length'] = String(bodyLength)
  }

  const transport = requestUrl.protocol === 'https:' ? https : http
  return sendCredentialRequest(
    transport,
    requestUrl,
    { method: requestMethod, headers: requestHeaders },
    requestBody,
    requestTimeout
  )
}

function findCredentialData(response) {
  let current = response

  for (let depth = 0; depth < 3 && current && typeof current === 'object'; depth += 1) {
    if (current.TmpSecretId || current.tmpSecretId) {
      return current
    }
    current = current.data
  }

  return null
}

function normalizeCredentialTimestamp(value, fieldName) {
  const timestamp = Number(value)
  if (!Number.isFinite(timestamp) || timestamp <= 0) {
    throw new Error(`[${packName}] temporary credential ${fieldName} is invalid`)
  }

  const seconds = Math.floor(timestamp >= 1e12 ? timestamp / 1000 : timestamp)
  if (!Number.isSafeInteger(seconds) || String(seconds).length !== 10) {
    throw new Error(`[${packName}] temporary credential ${fieldName} must be a 10-digit epoch timestamp`)
  }

  return seconds
}

function normalizeCredentials(credentials) {
  if (!credentials || typeof credentials !== 'object') {
    throw new Error(`[${packName}] temporary credential response does not contain credential data`)
  }

  const now = Math.floor(Date.now() / 1000)
  const result = {
    TmpSecretId: credentials.TmpSecretId || credentials.tmpSecretId,
    TmpSecretKey: credentials.TmpSecretKey || credentials.tmpSecretKey,
    SecurityToken:
      credentials.SecurityToken ||
      credentials.sessionToken ||
      credentials.XCosSecurityToken ||
      credentials.xCosSecurityToken ||
      credentials.xcosSecurityToken
  }

  if (!result.TmpSecretId || !result.TmpSecretKey || !result.SecurityToken) {
    throw new Error(`[${packName}] temporary credential response is incomplete`)
  }

  result.StartTime = normalizeCredentialTimestamp(credentials.StartTime ?? credentials.startTime ?? now - 1, 'StartTime')
  result.ExpiredTime = normalizeCredentialTimestamp(credentials.ExpiredTime ?? credentials.expiredTime, 'ExpiredTime')

  if (result.ExpiredTime <= now) {
    throw new Error(`[${packName}] temporary credential has expired`)
  }

  return result
}

const CREDENTIAL_METHODS = new Set(['GET', 'POST'])

function normalizeCredentialEndpoint(endpoint) {
  const url = typeof endpoint === 'string' ? endpoint.trim() : ''
  if (!url) {
    throw new Error(
      `[${packName}] temporary credential endpoint is required; configure temporaryCredentials.endpoint, or provide SecretId/SecretKey or getAuthorization`
    )
  }

  let parsedUrl
  try {
    parsedUrl = new URL(url)
  } catch {
    throw new Error(`[${packName}] temporary credential endpoint is not a valid URL: ${url}`)
  }
  if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
    throw new Error(`[${packName}] temporary credential endpoint must be an http(s) URL: ${url}`)
  }

  return url
}

function normalizeCredentialMethod(method) {
  const normalized = String(method || 'GET').toUpperCase()
  if (!CREDENTIAL_METHODS.has(normalized)) {
    throw new Error(`[${packName}] temporary credential request method must be GET or POST`)
  }

  return normalized
}

export async function requestTemporaryCredentials(options = {}) {
  const endpoint = normalizeCredentialEndpoint(options.endpoint)
  const method = normalizeCredentialMethod(options.method)
  const requestOptions = {
    url: endpoint,
    method,
    params: options.params,
    headers: options.headers || {},
    data: options.data,
    timeout: normalizeRequestTimeout(options.timeout)
  }
  const request = options.request || defaultCredentialRequest
  const response = await request(requestOptions)
  const credentialData = options.transformResponse
    ? await options.transformResponse(response)
    : findCredentialData(response)

  if (!credentialData) {
    const detail = getCredentialResponseMessage(response)
    const message = `[${packName}] temporary credential response does not contain credential data`
    throw new Error(detail ? `${message}: ${detail}` : message)
  }

  return normalizeCredentials(credentialData)
}

export function createTemporaryCredentialProvider(options = {}) {
  const refreshBeforeExpires = Math.max(
    0,
    Number(options.refreshBeforeExpires ?? DEFAULT_REFRESH_BEFORE_EXPIRES) || 0
  )
  let cachedCredentials = null
  let credentialRequest = null
  let nextRefreshAttemptAt = 0

  return async function getTemporaryCredentials() {
    const now = Math.floor(Date.now() / 1000)
    if (cachedCredentials) {
      const credentialLifetime = cachedCredentials.ExpiredTime - cachedCredentials.StartTime
      const refreshWindow = Math.min(
        refreshBeforeExpires,
        Math.max(0, Math.floor(credentialLifetime / 2))
      )
      const secondsRemaining = cachedCredentials.ExpiredTime - now
      if (secondsRemaining > refreshWindow || (secondsRemaining > 0 && now < nextRefreshAttemptAt)) {
        return cachedCredentials
      }
    }

    if (!credentialRequest) {
      credentialRequest = requestTemporaryCredentials(options)
        .then(credentials => {
          cachedCredentials = credentials
          nextRefreshAttemptAt = 0
          return credentials
        })
        .catch(error => {
          const refreshNow = Math.floor(Date.now() / 1000)
          const secondsRemaining = cachedCredentials
            ? cachedCredentials.ExpiredTime - refreshNow
            : 0
          if (!cachedCredentials || secondsRemaining <= 0) {
            throw error
          }

          nextRefreshAttemptAt = refreshNow + Math.max(1, Math.min(5, secondsRemaining))
          console.error(
            `[${packName}] temporary credential refresh failed; reusing valid cached credentials until expiry`,
            error
          )
          return cachedCredentials
        })
        .finally(() => {
          credentialRequest = null
        })
    }

    return credentialRequest
  }
}

function resolveTemporaryCredentialOptions(options) {
  if (Boolean(options.SecretId) !== Boolean(options.SecretKey)) {
    throw new Error(`[${packName}] SecretId and SecretKey must be provided together`)
  }

  if (options.temporaryCredentials === false) {
    return null
  }

  if (options.temporaryCredentials && typeof options.temporaryCredentials === 'object') {
    return options.temporaryCredentials
  }

  if (options.temporaryCredentials === true) {
    return {}
  }

  if (!options.getAuthorization && (!options.SecretId || !options.SecretKey)) {
    return {}
  }

  return null
}

function isCredentialAuthorizationError(error) {
  const message = error && typeof error === 'object' && typeof error.message === 'string'
    ? error.message
    : String(error)
  return message.includes('getAuthorization callback params')
}

function createCosClient(options, credentialErrorState = { current: null }) {
  const cosOptions = { ...options }
  PLUGIN_OPTIONS.forEach(key => delete cosOptions[key])

  const temporaryCredentialOptions = resolveTemporaryCredentialOptions(options)
  if (temporaryCredentialOptions) {
    normalizeCredentialEndpoint(temporaryCredentialOptions.endpoint)
    const getTemporaryCredentials = createTemporaryCredentialProvider(temporaryCredentialOptions)
    cosOptions.getAuthorization = (_authorizationOptions, callback) => {
      const requestErrorState = credentialErrorState.current
      getTemporaryCredentials()
        .then(credentials => {
          callback(credentials)
        })
        .catch(error => {
          if (requestErrorState && !requestErrorState.hasError) {
            requestErrorState.error = error
            requestErrorState.hasError = true
          }
          console.error(`[${packName}] temporary credential request failed:`, error)
          callback({})
        })
    }
    delete cosOptions.SecretId
    delete cosOptions.SecretKey
  }

  return new COS(cosOptions)
}

function getIgnorePatterns(options, ssrClient, ssrServer) {
  if (options.ignore !== undefined) {
    if (Array.isArray(options.ignore)) {
      return options.ignore
    }
    return options.ignore ? [options.ignore] : []
  }
  if (ssrClient) {
    return ['**/ssr-manifest.json', '**/*.html']
  }
  if (ssrServer) {
    return ['**']
  }
  return ['**/*.html']
}

async function assertOutputDirectory(outDirPath) {
  let details
  try {
    details = await stat(outDirPath)
  } catch (error) {
    if (error?.code === 'ENOENT') {
      throw new Error(`[${packName}] output directory does not exist: ${outDirPath}`)
    }
    throw error
  }

  if (!details.isDirectory()) {
    throw new Error(`[${packName}] output path is not a directory: ${outDirPath}`)
  }
}

function getIncludeEntries(includeFiles) {
  if (includeFiles === undefined) {
    return null
  }
  if (!Array.isArray(includeFiles)) {
    throw new Error(`[${packName}] files must be an array of relative paths within outDir`)
  }

  return includeFiles.map(file => {
    if (typeof file !== 'string') {
      throw new Error(`[${packName}] files must contain relative paths within outDir`)
    }
    const relativePath = normalizePath(file)
    if (
      !relativePath ||
      relativePath.startsWith('/') ||
      /^[A-Za-z]:\//.test(relativePath) ||
      relativePath.split('/').includes('..')
    ) {
      throw new Error(`[${packName}] files must contain relative paths within outDir`)
    }
    return { raw: relativePath, pattern: escapePath(relativePath) }
  })
}

async function findMissingUploadFiles(outDirPath, includeEntries) {
  const missing = []

  for (const { raw } of includeEntries) {
    try {
      const details = await stat(path.resolve(outDirPath, raw))
      if (!details.isFile()) {
        missing.push(raw)
      }
    } catch (error) {
      if (error?.code === 'ENOENT' || error?.code === 'ENOTDIR') {
        missing.push(raw)
      } else {
        throw error
      }
    }
  }

  return missing
}

async function resolveUploadFiles(outDirPath, includeEntries, options, ssrClient, ssrServer) {
  const globOptions = {
    cwd: outDirPath,
    absolute: true,
    dot: true,
    onlyFiles: true,
    ignore: getIgnorePatterns(options, ssrClient, ssrServer)
  }

  if (includeEntries === null) {
    await assertOutputDirectory(outDirPath)
    return globSync('**/*', globOptions)
  }
  if (includeEntries.length === 0) {
    return []
  }

  const missing = await findMissingUploadFiles(outDirPath, includeEntries)
  if (missing.length > 0) {
    const preview = missing.slice(0, 5).join(', ')
    const remainder = missing.length > 5 ? `, and ${missing.length - 5} more` : ''
    throw new Error(
      `[${packName}] selected upload files were not found under ${outDirPath}: ${preview}${remainder}`
    )
  }

  return globSync(includeEntries.map(entry => entry.pattern), globOptions)
}

function getUploadTarget(outDirPath, fileFullPath, cosBasePath, cosOrigin) {
  const relativePath = normalizePath(path.relative(outDirPath, fileFullPath))
  const cosFilePath = `${cosBasePath.replace(/\/$/, '')}/${relativePath}`
  const completePath = cosOrigin + cosFilePath
  const output = `${normalizePath(fileFullPath)} => ${color.green(completePath)}`
  return { cosFilePath, output }
}

async function uploadFileWithRetry({ client, credentialErrorState, params, retries, output }) {
  await retry(async () => {
    const attemptErrorState = { error: null, hasError: false }
    credentialErrorState.current = attemptErrorState

    try {
      await client.uploadFile(params)
    } catch (error) {
      if (attemptErrorState.hasError && isCredentialAuthorizationError(error)) {
        throw attemptErrorState.error
      }
      throw error
    } finally {
      if (credentialErrorState.current === attemptErrorState) {
        credentialErrorState.current = null
      }
    }

    console.log(`upload complete: ${output}`)
  }, retries)
}

async function uploadFilesToCOS(files, context) {
  for (const fileFullPath of files) {
    const { outDirPath, cosBasePath, cosOrigin, options, client, credentialErrorState } = context
    const { cosFilePath, output } = getUploadTarget(outDirPath, fileFullPath, cosBasePath, cosOrigin)
    if (options.test) {
      console.log(`test upload path: ${output}`)
      continue
    }

    await uploadFileWithRetry({
      client,
      credentialErrorState,
      params: {
        Bucket: options.bucket,
        Region: options.region,
        Key: cosFilePath,
        StorageClass: 'STANDARD',
        FilePath: fileFullPath,
        SliceSize: 1024 * 1024 * 5
      },
      retries: options.retry,
      output
    })
  }
}

export async function uploadToCOS({ outDir, files: includeFiles, base, ssrClient = false, ssrServer = false, options = {} }) {
  if (options.enabled === false) {
    return
  }
  if (typeof base !== 'string' || !/^https?:\/\//i.test(base)) {
    throw new Error(`[${packName}] base/publicPath must be an http(s) URL`)
  }
  if (!options.bucket || !options.region) {
    throw new Error(`[${packName}] bucket and region are required`)
  }

  const outDirPath = normalizePath(path.resolve(outDir || 'dist'))
  const { pathname: cosBasePath, origin: cosOrigin } = new URL(base)
  const includeEntries = getIncludeEntries(includeFiles)
  const files = await resolveUploadFiles(outDirPath, includeEntries, options, ssrClient, ssrServer)
  const credentialErrorState = { current: null }
  // A test run only prints target paths, so it must not require usable credentials.
  const client = options.test ? null : createCosClient(options, credentialErrorState)

  console.log('')
  console.log(`${packName} upload start${ssrClient ? ' (ssr client)' : ssrServer ? ' (ssr server)' : ''}`)
  console.log('')

  const startTime = Date.now()
  await uploadFilesToCOS(files, {
    outDirPath,
    cosBasePath,
    cosOrigin,
    options,
    client,
    credentialErrorState
  })

  const duration = (Date.now() - startTime) / 1000
  console.log('')
  console.log(`${packName} upload complete, cost ${duration.toFixed(2)}s`)
  console.log('')
}

export default function vitePluginWalleCOS(options = {}) {
  let baseConfig = '/'
  let rootConfig = process.cwd()
  let buildConfig = {}
  let useSequentialCloseBundle = false
  const closeBundle = async () => {
    await uploadToCOS({
      outDir: path.resolve(rootConfig, buildConfig.outDir || 'dist'),
      base: baseConfig,
      ssrClient: Boolean(buildConfig.ssrManifest),
      ssrServer: Boolean(buildConfig.ssr),
      options
    })
  }
  const plugin = {
    name: packName,
    enforce: 'post',
    apply: 'build',
    configResolved(config) {
      baseConfig = config.base
      rootConfig = config.root
      buildConfig = config.build || {}
      useSequentialCloseBundle = supportsSequentialCloseBundle(rootConfig)
    },
    get closeBundle() {
      return useSequentialCloseBundle
        ? { order: 'post', sequential: true, handler: closeBundle }
        : closeBundle
    }
  }

  return plugin
}
