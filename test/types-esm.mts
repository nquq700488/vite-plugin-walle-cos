import vitePluginWalleCOS, {
  createTemporaryCredentialProvider,
  requestTemporaryCredentials,
  uploadToCOS
} from 'vite-plugin-walle-cos'
import WebpackPluginWalleCOS from 'vite-plugin-walle-cos/webpack'

vitePluginWalleCOS({ bucket: 'test-1234567890', region: 'ap-beijing' })
createTemporaryCredentialProvider()
void requestTemporaryCredentials()
void uploadToCOS({ base: 'https://static.example.com/', options: { bucket: 'test-1234567890', region: 'ap-beijing' } })
new WebpackPluginWalleCOS({ bucket: 'test-1234567890', region: 'ap-beijing' })
