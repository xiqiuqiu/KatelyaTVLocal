#!/usr/bin/env node
/* eslint-disable */
// 根据 SITE_NAME 动态生成 manifest.json

const fs = require('fs');
const path = require('path');

// 获取项目根目录
const projectRoot = path.resolve(__dirname, '..');
const publicDir = path.join(projectRoot, 'public');
const manifestPath = path.join(publicDir, 'manifest.json');

function getEnvValue(key) {
  for (const fileName of ['.env.local', '.env']) {
    const envPath = path.join(projectRoot, fileName);
    if (!fs.existsSync(envPath)) {
      continue;
    }

    const match = fs
      .readFileSync(envPath, 'utf8')
      .split(/\r?\n/)
      .map((line) => line.match(new RegExp(`^${key}=(.*)$`)))
      .find(Boolean);

    if (match) {
      return match[1].replace(/^['"]|['"]$/g, '').trim();
    }
  }

  return '';
}

// 从环境变量获取站点名称
const siteName =
  process.env.SITE_NAME || getEnvValue('SITE_NAME') || 'KatelyaTV';

// manifest.json 模板
const manifestTemplate = {
  name: siteName,
  short_name: siteName,
  description: '影视聚合搜索与在线播放',
  start_url: '/',
  scope: '/',
  display: 'standalone',
  background_color: '#0B0F14',
  'apple-mobile-web-app-capable': 'yes',
  'apple-mobile-web-app-status-bar-style': 'black',
  icons: [
    {
      src: '/icons/icon-192x192.png',
      sizes: '192x192',
      type: 'image/png',
    },
    {
      src: '/icons/icon-256x256.png',
      sizes: '256x256',
      type: 'image/png',
    },
    {
      src: '/icons/icon-384x384.png',
      sizes: '384x384',
      type: 'image/png',
    },
    {
      src: '/icons/icon-512x512.png',
      sizes: '512x512',
      type: 'image/png',
    },
  ],
};

try {
  // 确保 public 目录存在
  if (!fs.existsSync(publicDir)) {
    fs.mkdirSync(publicDir, { recursive: true });
  }

  // 写入 manifest.json
  fs.writeFileSync(manifestPath, JSON.stringify(manifestTemplate, null, 2));
  console.log(`✅ Generated manifest.json with site name: ${siteName}`);
} catch (error) {
  console.error('❌ Error generating manifest.json:', error);
  process.exit(1);
}
