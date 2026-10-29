# vite-plugin-walle-cos

将 Vite 或 Webpack 的生产构建资源上传到 Tencent COS，默认不上传 HTML。

## 支持范围

- Vite 2 - 7，支持 ESM 和 CommonJS 配置
- Webpack 4 / 5
- Node.js 14.18+
- 凭证来源：永久密钥、自定义 `getAuthorization` 或临时密钥接口

## 安装

```bash
npm i -D vite-plugin-walle-cos
```

## Vite

```javascript
import { defineConfig } from 'vite'
import vitePluginWalleCOS from 'vite-plugin-walle-cos'

export default defineConfig({
  base: 'https://static.example.com/app/',
  plugins: [
    vitePluginWalleCOS({
      region: 'ap-beijing',
      bucket: 'example-1234567890'
    })
  ]
})
```

CommonJS 配置：

```javascript
const vitePluginWalleCOS = require('vite-plugin-walle-cos')
```

## Webpack 4 / 5

```javascript
const WebpackPluginWalleCOS = require('vite-plugin-walle-cos/webpack')

module.exports = {
  output: {
    path: require('node:path').resolve(__dirname, 'dist'),
    publicPath: 'https://static.example.com/app/'
  },
  plugins: [
    new WebpackPluginWalleCOS({
      region: 'ap-beijing',
      bucket: 'example-1234567890'
    })
  ]
}
```

## 工作方式

- **Vite**：插件只在 `build` 时生效，于 `closeBundle` 阶段上传 `build.outDir`；相对路径按 `config.root` 解析，上传前缀取 `config.base`。
- **Webpack**：于 `afterEmit` 阶段上传当前 compilation 的资源；`outDir` 默认取 `output.path`，`base` 默认取 `output.publicPath`，都可用插件参数覆盖。
- **Webpack 触发条件**：`development` 构建和 watch 编译（含 dev server）不上传，并打印一次跳过原因；`production`、`none` 以及未设置 `mode` 的构建都会上传。
- **Webpack 上传范围**：只上传当前 compilation 声明的资源，不会重复上传 `output.path` 中残留的旧文件。
- **HTML**：默认忽略 `**/*.html`；SSR 客户端构建额外忽略 `ssr-manifest.json`，SSR 服务端构建忽略全部文件。
- **`base` / `publicPath`**：必须是完整的 HTTP(S) URL，否则直接报错。
- **`closeBundle` 顺序**：Rollup 3 及以上使用顺序钩子，会等其他 `closeBundle` 写完后再上传。Rollup 2 不支持顺序钩子配置，只能使用函数钩子，因此不要依赖其他异步 `closeBundle` 生成的资源；无法探测 Rollup 版本时会告警并回退到这种模式。
- **`test: true`**：只打印目标路径，不创建 COS 客户端，也不需要可用凭证。

## 凭证

按以下顺序决定凭证来源：

| 优先级 | 条件 | 行为 |
| --- | --- | --- |
| 1 | 显式配置 `temporaryCredentials: { ... }` | 使用临时密钥接口，必须提供 `endpoint` |
| 2 | 未显式配置临时密钥，但提供了 `getAuthorization` | 交给自定义回调，插件不请求临时密钥 |
| 3 | 未配置以上两项，且同时提供 `SecretId` 和 `SecretKey` | 使用永久密钥 |
| 4 | 以上都没有 | 进入临时密钥模式，因缺少 `endpoint` 直接报错 |

补充说明：

- 只提供 `SecretId` 或 `SecretKey` 其中一个会直接报错。
- `temporaryCredentials: false` 关闭临时密钥逻辑。
- `temporaryCredentials: true` 等价于启用临时密钥但不带任何配置，仍需通过 `temporaryCredentials: { endpoint }` 提供地址。

### 永久密钥

```javascript
{
  region: 'ap-beijing',
  bucket: 'example-1234567890',
  SecretId: process.env.COS_SECRET_ID,
  SecretKey: process.env.COS_SECRET_KEY
}
```

### 临时密钥

临时密钥接口地址必须显式提供，不存在内置地址兜底；未提供时上传直接报错。

```javascript
vitePluginWalleCOS({
  region: 'ap-beijing',
  bucket: 'example-1234567890',
  temporaryCredentials: {
    endpoint: 'https://gateway.example.com/cos/credential'
  }
})
```

请求方法仅支持 `GET`（默认）和 `POST`，接口地址必须是 HTTP(S) URL。

默认识别以下响应结构（`data` 可嵌套最多 3 层）：

```javascript
{
  code: '0',
  data: {
    tmpSecretId,
    tmpSecretKey,
    sessionToken,
    startTime,
    expiredTime
  }
}
```

字段兼容如下，时间戳支持秒或毫秒（大于等于 `1e12` 视为毫秒）：

| 字段 | 可接受的键名 | 说明 |
| --- | --- | --- |
| 密钥 ID | `TmpSecretId` / `tmpSecretId` | 必填 |
| 密钥 Key | `TmpSecretKey` / `tmpSecretKey` | 必填 |
| 临时 Token | `SecurityToken` / `sessionToken` / `XCosSecurityToken` | 必填 |
| 生效时间 | `StartTime` / `startTime` | 缺省为当前时间前 1 秒 |
| 过期时间 | `ExpiredTime` / `expiredTime` | 必填，已过期直接报错 |

缓存与刷新行为：

- 到期前 `refreshBeforeExpires`（默认 60 秒）触发刷新，实际窗口取 `min(refreshBeforeExpires, 有效期 / 2)`，短寿命密钥不会被反复刷新。
- 并发上传复用同一个请求 Promise。
- 刷新失败时，只要缓存密钥仍未过期就继续使用，并在 1 - 5 秒内不重复重试；密钥已过期则报错。
- 接口报错会附带网关返回的 `message` / `msg` / `error` 文本（截断到 200 字），便于定位。

请求方法、参数、请求头、请求体和超时都可以覆盖：

```javascript
vitePluginWalleCOS({
  region: 'ap-beijing',
  bucket: 'example-1234567890',
  temporaryCredentials: {
    endpoint: 'https://gateway.example.com/cos/credential',
    method: 'POST',
    params: { channel: 'front-end' },
    headers: { 'x-app-id': 'web' },
    data: { scope: 'assets' },
    timeout: 10000,
    refreshBeforeExpires: 60
  }
})
```

`timeout` 必须为正数；传入 `0`、负数或非法值会回退到默认的 10000 毫秒，避免构建在接口无响应时一直挂起。

如需复用 Axios、网关签名或其他请求封装，可传入 `request`：

```javascript
import axios from 'axios'

const temporaryCredentials = {
  endpoint: 'https://gateway.example.com/cos/credential',
  method: 'GET',
  params: { channel: 'pt-front-kind' },
  request: async ({ url, method, params, headers, data, timeout }) => {
    const response = await axios({ url, method, params, headers, data, timeout })
    return response.data
  }
}
```

不同接口响应可通过 `transformResponse` 转为 SDK 所需字段：

```javascript
temporaryCredentials: {
  endpoint: 'https://gateway.example.com/cos/credential',
  transformResponse(response) {
    return {
      TmpSecretId: response.result.id,
      TmpSecretKey: response.result.key,
      SecurityToken: response.result.token,
      StartTime: response.result.start,
      ExpiredTime: response.result.expires
    }
  }
}
```

### 自定义授权

已有网关或 STS 封装时，可以直接交给 COS SDK：

```javascript
{
  region: 'ap-beijing',
  bucket: 'example-1234567890',
  getAuthorization(_options, callback) {
    callback({
      TmpSecretId: process.env.TMP_SECRET_ID,
      TmpSecretKey: process.env.TMP_SECRET_KEY,
      SecurityToken: process.env.SECURITY_TOKEN,
      StartTime: Number(process.env.START_TIME),
      ExpiredTime: Number(process.env.EXPIRED_TIME)
    })
  }
}
```

示例中的凭证均来自环境变量，请勿把密钥写进仓库。

## 配置项

| 配置 | 说明 | 默认值 |
| --- | --- | --- |
| `region` | Tencent COS 地域，必填 | - |
| `bucket` | Tencent COS 存储桶，必填 | - |
| `SecretId` | 永久密钥 ID，须与 `SecretKey` 同时提供 | - |
| `SecretKey` | 永久密钥 Key，须与 `SecretId` 同时提供 | - |
| `getAuthorization` | 自定义 COS SDK 授权回调 | - |
| `temporaryCredentials` | 临时密钥配置；设为 `false` 可禁用 | 无永久密钥且无 `getAuthorization` 时自动启用 |
| `ignore` | 文件忽略 glob；传 `''` 不忽略 | `'**/*.html'` |
| `Timeout` | COS SDK 超时，单位毫秒；`0` 表示不超时 | `0` |
| `test` | 仅打印上传路径，不创建客户端 | `false` |
| `enabled` | 是否启用上传 | `true` |
| `retry` | 上传失败重试次数，每次间隔 500ms | `0` |
| `base` | 仅 Webpack：覆盖 `output.publicPath` | `output.publicPath` |
| `outDir` | 仅 Webpack：覆盖 `output.path` | `output.path` |

`temporaryCredentials` 子项：

| 配置 | 说明 | 默认值 |
| --- | --- | --- |
| `endpoint` | 临时密钥接口地址，必填且必须是 HTTP(S) URL | - |
| `method` | 请求方法，仅支持 `GET` / `POST` | `GET` |
| `params` | URL 查询参数 | 不附加 |
| `headers` | 请求头 | - |
| `data` | 非 GET 请求体；普通对象按 JSON 发送 | - |
| `timeout` | 请求超时，非正数回退默认 | `10000` |
| `refreshBeforeExpires` | 到期前提前刷新秒数 | `60` |
| `request` | 自定义请求实现，返回响应体 | 内置 http/https |
| `transformResponse` | 自定义响应转换 | 内置结构识别 |

## 编程接口

ESM 具名导出，CommonJS 下是入口函数的同名属性：

```javascript
import {
  requestTemporaryCredentials,
  createTemporaryCredentialProvider,
  uploadToCOS
} from 'vite-plugin-walle-cos'
```

| 接口 | 说明 |
| --- | --- |
| `requestTemporaryCredentials(options)` | 请求并归一化一次临时密钥，参数与 `temporaryCredentials` 相同 |
| `createTemporaryCredentialProvider(options)` | 返回带缓存的取密钥函数，适合多次复用 |
| `uploadToCOS({ outDir, files, base, ssrClient, ssrServer, options })` | 上传整个目录或指定文件 |

`files` 为相对 `outDir` 的路径数组，任一文件不存在都会报错，避免静默漏传；被 `ignore` 忽略的文件（如 HTML）视为已处理。示例：

```javascript
import { createTemporaryCredentialProvider } from 'vite-plugin-walle-cos'

const getCredentials = createTemporaryCredentialProvider({
  endpoint: 'https://gateway.example.com/cos/credential'
})

const { TmpSecretId, SecurityToken, ExpiredTime } = await getCredentials()
```

## 常见错误

| 报错 | 原因 |
| --- | --- |
| `base/publicPath must be an http(s) URL` | `base` / `publicPath` 不是完整 URL |
| `bucket and region are required` | 缺少必填配置 |
| `SecretId and SecretKey must be provided together` | 永久密钥只配置了一半 |
| `temporary credential endpoint is required` | 启用了临时密钥但没有配置 `endpoint` |
| `temporary credential request method must be GET or POST` | 使用了其他请求方法 |
| `temporary credential endpoint is not a valid URL` | `endpoint` 不是合法 URL 或不是 HTTP(S) |
| `output directory does not exist` | `outDir` 不存在，通常是构建失败或路径配置错误 |
| `selected upload files were not found` | 指定文件不在 `outDir` 中，或构建产物名已变化 |

## 兼容性测试

`.github/workflows/compatibility.yml` 会执行以下真实构建矩阵：

- Vite 2、3、4、5、6、7
- Webpack 4、5

测试使用 `test: true`，会执行完整构建和上传钩子，但不会向 COS 写入文件。Vite 测试默认使用 `example/vite-6` 中安装的版本；Webpack 是可选 peer dependency，本地验证时需要先安装并指定依赖目录：

```bash
pnpm test:compat:vite

webpack_prefix="$(mktemp -d)"
npm install --prefix "$webpack_prefix" --no-save webpack@5
COMPAT_PREFIX="$webpack_prefix" pnpm test:compat:webpack
```

CI 会通过 `COMPAT_PREFIX` 为每个兼容性矩阵版本提供独立安装目录。
