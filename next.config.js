/** @type {import('next').NextConfig} */
/* eslint-disable @typescript-eslint/no-var-requires */
const playbackReleaseId =
  process.env.NEXT_PUBLIC_PLAYBACK_RELEASE_ID ||
  process.env.CF_PAGES_COMMIT_SHA ||
  process.env.GITHUB_SHA ||
  'unknown';
const playbackDeployment =
  process.env.NEXT_PUBLIC_PLAYBACK_DEPLOYMENT ||
  process.env.CF_PAGES_BRANCH ||
  (process.env.DOCKER_ENV === 'true' ? 'docker' : 'local');
const nextConfig = {
  env: {
    NEXT_PUBLIC_PLAYBACK_RELEASE_ID: `${playbackReleaseId.slice(
      0,
      80
    )}@${playbackDeployment.slice(0, 40)}`,
  },
  output: process.env.DOCKER_ENV === 'true' ? 'standalone' : undefined,
  eslint: {
    dirs: ['src'],
  },

  // Resolve Node16-style .js imports to their TypeScript source while bundling.
  experimental: {
    extensionAlias: { '.js': ['.js', '.ts', '.tsx'] },
  },

  reactStrictMode: false,
  swcMinify: true,

  // Uncoment to add domain whitelist
  images: {
    unoptimized: true,
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '**',
      },
      {
        protocol: 'http',
        hostname: '**',
      },
    ],
  },

  webpack(config) {
    // Grab the existing rule that handles SVG imports
    const fileLoaderRule = config.module.rules.find((rule) =>
      rule.test?.test?.('.svg')
    );

    config.module.rules.push(
      // Reapply the existing rule, but only for svg imports ending in ?url
      {
        ...fileLoaderRule,
        test: /\.svg$/i,
        resourceQuery: /url/, // *.svg?url
      },
      // Convert all other *.svg imports to React components
      {
        test: /\.svg$/i,
        issuer: { not: /\.(css|scss|sass)$/ },
        resourceQuery: { not: /url/ }, // exclude if *.svg?url
        loader: '@svgr/webpack',
        options: {
          dimensions: false,
          titleProp: true,
        },
      }
    );

    // Modify the file loader rule to ignore *.svg, since we have it handled now.
    fileLoaderRule.exclude = /\.svg$/i;

    config.resolve.fallback = {
      ...config.resolve.fallback,
      net: false,
      tls: false,
      crypto: false,
    };

    return config;
  },
};

const withPWA = require('next-pwa')({
  dest: 'public',
  disable: process.env.NODE_ENV === 'development',
  publicExcludes: ['!tv-test/hls/**/*'],
  register: true,
  skipWaiting: true,
});

module.exports = withPWA(nextConfig);
