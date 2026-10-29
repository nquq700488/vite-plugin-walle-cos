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
  /** 临时密钥接口地址，必填；未提供时上传直接报错 */
  endpoint?: string
  /** 请求方法，仅支持 GET（默认）和 POST */
  method?: string
  /** URL 查询参数，默认不附加 */
  params?: Record<string, unknown>
  /** 请求头 */
  headers?: Record<string, string>
  /** 非 GET/HEAD 请求的请求体；普通对象默认序列化为 JSON */
  data?: unknown
  /** 请求超时，单位毫秒，默认 10000；非正数或非法值回退到默认值 */
  timeout?: number
  /** 自定义请求实现，返回接口响应体 */
  request?: (options: TemporaryCredentialRequest) => Promise<unknown>
  /** 将自定义接口响应转换为临时密钥 */
  transformResponse?: (response: unknown) => TemporaryCredentials | Record<string, unknown> | Promise<TemporaryCredentials | Record<string, unknown>>
  /** 到期前提前刷新秒数，默认 60 */
  refreshBeforeExpires?: number
}

export interface Options {
  /** Tencent COS 地域 */
  region: string
  /** 永久密钥 ID；未配置完整永久密钥时默认改用临时密钥 */
  SecretId?: string
  /** 永久密钥 Key；未配置完整永久密钥时默认改用临时密钥 */
  SecretKey?: string
  /** Tencent COS 存储桶 */
  bucket: string
  /** 文件忽略规则，默认忽略所有 HTML 文件；传空字符串表示不忽略 */
  ignore?: string[] | string
  /** 仅打印上传路径，不上传文件，默认 false */
  test?: boolean
  /** 是否启用插件，默认 true */
  enabled?: boolean
  /** 上传失败重试次数，默认 0 */
  retry?: number
  /** 自定义 COS SDK 授权回调；优先级低于显式 temporaryCredentials 配置 */
  getAuthorization?: (
    options: GetAuthorizationOptions,
    callback: (params: GetAuthorizationCallbackParams) => void,
  ) => void
  /** COS SDK 超时时间，单位毫秒 */
  Timeout?: string | number
  /** 临时密钥配置；无永久密钥时默认启用，设为 false 可禁用 */
  temporaryCredentials?: boolean | TemporaryCredentialOptions
}

export interface UploadOptions {
  outDir?: string
  /** Restrict uploads to these paths relative to outDir; missing entries reject the upload */
  files?: string[]
  base: string
  ssrClient?: boolean
  ssrServer?: boolean
  options: Options
}

export type CloseBundleHandler = () => Promise<void>

/** Rollup 3+ 使用顺序 hook 对象；Rollup 2 只能使用函数形式 */
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

export declare function requestTemporaryCredentials(options?: TemporaryCredentialOptions): Promise<TemporaryCredentials>

export declare function createTemporaryCredentialProvider(
  options?: TemporaryCredentialOptions,
): () => Promise<TemporaryCredentials>

export declare function uploadToCOS(options: UploadOptions): Promise<void>

declare function vitePluginWalleCOS(options?: Options): WalleVitePlugin

export default vitePluginWalleCOS
