# Docker + Kvrocks Troubleshooting

## Common Issues

### 1. "failed to read dockerfile: open Dockerfile: no such file or directory"

**Cause:** Using an old `docker-compose.kvrocks.yml` that references `build: .` instead of prebuilt image.

**Solution:** Download the latest config:
```bash
curl -O https://raw.githubusercontent.com/katelya77/KatelyaTV/main/docker-compose.kvrocks.yml
docker compose -f docker-compose.kvrocks.yml up -d
```

Or build locally:
```bash
git clone https://github.com/katelya77/KatelyaTV.git
cd KatelyaTV
docker compose -f docker-compose.kvrocks.local.yml up -d
```

### 2. Kvrocks Connection Failed

**Symptoms:** `Error: connect ECONNREFUSED` in app logs

**Solutions:**
1. Check `KVROCKS_URL=redis://kvrocks:6666` in `.env`
2. Verify Kvrocks service: `docker compose -f docker-compose.kvrocks.yml ps`
3. Test connection: `docker compose -f docker-compose.kvrocks.yml exec kvrocks redis-cli -h localhost -p 6666 ping`

### 3. Environment Variable Misconfiguration

**Common errors:**
- `KVROCKS_PASSWORD` mismatch
- `KVROCKS_URL` wrong host/port

**Required variables:**
```bash
NEXT_PUBLIC_STORAGE_TYPE=kvrocks
KVROCKS_URL=redis://kvrocks:6666
KVROCKS_PASSWORD=your_secure_password
```

### 4. Container Startup Failure

```bash
# Check status
docker compose ps

# View detailed logs
docker compose logs katelyatv

# Common causes: port conflicts, env var errors, image pull failure
```

## Debug Commands

```bash
# Service status
docker compose -f docker-compose.kvrocks.yml ps

# App logs
docker compose -f docker-compose.kvrocks.yml logs -f katelyatv

# Kvrocks logs
docker compose -f docker-compose.kvrocks.yml logs -f kvrocks

# Enter container
docker compose -f docker-compose.kvrocks.yml exec katelyatv sh

# Rebuild
docker compose -f docker-compose.kvrocks.yml up -d --force-recreate
```
