# Deployment Compatibility

## Deployment Methods

| Method | Runtime | Multi-User | Data Reliability |
|--------|---------|------------|-----------------|
| Docker (single) | Node.js | No | Medium |
| Docker + Redis | Node.js | Yes | High |
| Docker + Kvrocks | Node.js | Yes | Very High |
| Vercel | Edge/Node.js | No | Low |
| Cloudflare Pages | Edge | Yes (with D1) | High |

## Storage Backends

| Backend | Env Value | Multi-Device Sync | Best For |
|---------|-----------|-------------------|----------|
| LocalStorage | `localstorage` | No | Single user, quick setup |
| Redis | `redis` | Yes | Home/team use |
| Kvrocks | `kvrocks` | Yes | Production, high reliability |
| Cloudflare D1 | `d1` | Yes | Cloudflare deployments |
| Upstash Redis | `upstash` | Yes | Serverless deployments |

### Backend-Specific Config

**Redis:**
```bash
NEXT_PUBLIC_STORAGE_TYPE=redis
REDIS_URL=redis://localhost:6379
```

**Kvrocks:**
```bash
NEXT_PUBLIC_STORAGE_TYPE=kvrocks
KVROCKS_URL=redis://kvrocks:6666
KVROCKS_PASSWORD=your_password
```

**Upstash:**
```bash
NEXT_PUBLIC_STORAGE_TYPE=upstash
UPSTASH_URL=https://xxx.upstash.io
UPSTASH_TOKEN=xxx
```

**D1:**
```bash
NEXT_PUBLIC_STORAGE_TYPE=d1
# DB binding injected by Cloudflare automatically
```

## Runtime Compatibility

### Cloudflare Pages
- All API routes must use Edge Runtime (`export const runtime = 'edge'`)
- D1 binding name must be `DB`
- Build command: `pnpm pages:build`
- Output directory: `.vercel/output/static`

### Docker
- Dockerfile auto-converts Edge Runtime to Node.js Runtime
- Image: `ghcr.io/katelya77/katelyatv:latest`
- Multi-arch: `linux/amd64`, `linux/arm64`
- Based on Alpine Linux

### Vercel
- One-click deploy via Vercel CLI or GitHub import
- Auto-detects Edge/Node.js runtime
- No multi-user support without external storage

## Performance Recommendations

| Scale | Recommended Backend |
|-------|-------------------|
| < 100 users | LocalStorage (single instance) |
| < 1000 users | Redis |
| > 1000 users | D1 + Redis cache or Kvrocks |
