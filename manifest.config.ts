import { defineManifest } from '@crxjs/vite-plugin'
export default defineManifest({
  manifest_version: 3,
  name: '别想骗我点击 (StopBait)',
  version: '1.0.0',
  icons: {
    '16': 'icons/icon_16.png',
    '48': 'icons/icon_48.png',
    '128': 'icons/icon_128.png',
  },
  action: {
    default_popup: 'src/popup/index.html',
    default_icon: {
      '16': 'icons/icon_16.png',
      '48': 'icons/icon_48.png',
      '128': 'icons/icon_128.png',
    },
  },
  permissions: ['storage', 'tabs'],
  content_scripts: [
    {
      matches: ['*://xiaohongshu.com/*', '*://www.xiaohongshu.com/*'],
      js: ['src/content/main.ts'],
      run_at: 'document_idle',
    },
  ],
})

