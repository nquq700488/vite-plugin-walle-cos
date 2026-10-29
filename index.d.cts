declare function vitePluginWalleCOS(options?: vitePluginWalleCOS.Options): vitePluginWalleCOS.WalleVitePlugin

declare namespace vitePluginWalleCOS {
  export interface TemporaryCredentials {
    TmpSecretId: string
    TmpSecretKey: string
    SecurityToken: string
    StartTime: number
    ExpiredTime: number
  }

  export interface TemporaryCredentialRequest {
    url: string
    method: string
    params?: Record<string, unknown>
    headers: Record<string, string>
    data?: unknown
    timeout: number
  }

  export interface TemporaryCredentialOptions {
    endpoint?: string
    method?: string
    params?: Record<string, unknown>
    headers?: Record<string, string>
    data?: unknown
    timeout?: number
    request?: (options: TemporaryCredentialRequest) => Promise<unknown>
    transformResponse?: (response: unknown) => TemporaryCredentials | Record<string, unknown> | Promise<TemporaryCredentials | Record<string, unknown>>
    refreshBeforeExpires?: number
  }

  export interface GetAuthorizationOptions {
    Bucket: string
    Region: string
    Method: 'GET' | 'DELETE' | 'POST' | 'PUT' | 'OPTIONS' | 'get' | 'delete' | 'post' | 'put' | 'options'
    Pathname: string
    Key: string
    Query: Record<string, unknown>
    Headers: Record<string, unknown>
    Scope: Array<{
      action: string
      bucket: string
      region: string
      prefix: string
    }>
    SystemClockOffset: number
  }

  export interface GetAuthorizationCredentials {
    TmpSecretId: string
    TmpSecretKey: string
    SecurityToken?: string
    XCosSecurityToken?: string
    StartTime: number
    ExpiredTime: number
    ScopeLimit?: boolean
    Authorization?: string
  }

  export type GetAuthorizationCallbackParams = string | GetAuthorizationCredentials

  export interface Options {
    region: string
    SecretId?: string
    SecretKey?: string
    bucket: string
    ignore?: string[] | string
    test?: boolean
    enabled?: boolean
    retry?: number
    getAuthorization?: (
      options: GetAuthorizationOptions,
      callback: (params: GetAuthorizationCallbackParams) => void
    ) => void
    Timeout?: string | number
    temporaryCredentials?: boolean | TemporaryCredentialOptions
  }

  export interface UploadOptions {
    outDir?: string
    files?: string[]
    base: string
    ssrClient?: boolean
    ssrServer?: boolean
    options: Options
  }

  export type CloseBundleHandler = () => Promise<void>

  /** Rollup 3+ uses an object hook; Rollup 2 only accepts a function */
  export type CloseBundleHook =
    | CloseBundleHandler
    | { order: 'post'; sequential: true; handler: CloseBundleHandler }

  export interface WalleVitePlugin {
    name: string
    enforce: 'post'
    apply: 'build'
    configResolved(config: {
      root: string
      base: string
      build?: {
        outDir?: string
        ssrManifest?: boolean | string
        ssr?: boolean | string
      }
    }): void
    readonly closeBundle: CloseBundleHook
  }

  export function requestTemporaryCredentials(
    options?: TemporaryCredentialOptions
  ): Promise<TemporaryCredentials>

  export function createTemporaryCredentialProvider(
    options?: TemporaryCredentialOptions
  ): () => Promise<TemporaryCredentials>

  export function uploadToCOS(options: UploadOptions): Promise<void>
}

export = vitePluginWalleCOS
