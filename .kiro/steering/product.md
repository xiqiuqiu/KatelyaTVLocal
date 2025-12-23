# KatelyaTV Product Overview

KatelyaTV is a self-hosted video streaming aggregator built with Next.js. It aggregates content from multiple video source APIs (苹果 CMS V10 format) into a unified search and playback experience.

## Core Features

- Multi-source video search and aggregation
- HLS video playback with ArtPlayer
- Skip intro/outro functionality
- Watch history and favorites (cross-device sync)
- Multi-user support with authentication
- PWA support for mobile/desktop installation
- TVBox configuration export compatibility
- Dark/light theme support

## Target Users

- Self-hosters wanting a personal video streaming interface
- Users needing to aggregate multiple video source APIs
- TVBox users wanting web-based configuration management

## Deployment Options

- Docker (single container or with Redis/Kvrocks)
- Vercel (serverless)
- Cloudflare Pages (with D1 database)

## Storage Backends

- LocalStorage (single user, browser-only)
- Redis/Kvrocks (multi-user, recommended for production)
- Cloudflare D1 (serverless multi-user)
- Upstash Redis (serverless)
