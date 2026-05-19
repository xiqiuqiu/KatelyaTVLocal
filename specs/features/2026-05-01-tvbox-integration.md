# TVBox Configuration Interface

KatelyaTV supports TVBox configuration interface, allowing you to import configured video sources directly into TVBox-compatible applications.

## Usage

### 1. Access Configuration

Navigate to "TVBox Config" in the sidebar, or visit:

```
https://your-domain.com/config
```

### 2. Generate Config Link

- **JSON format (recommended)**: Standard JSON, easy to debug
- **Base64 format**: Encoded config for special environments

**JSON:**
```
https://your-domain.com/api/tvbox?format=json
```

**Base64:**
```
https://your-domain.com/api/tvbox?format=base64
```

### 3. Import to TVBox

1. Open your TVBox app
2. Go to Settings > Config Address
3. Paste the copied config link
4. Confirm import

## Features

- Auto-sync all KatelyaTV video sources
- Search and quick search support
- Category filtering
- Built-in video parsing interfaces
- Ad filtering rules
- CORS cross-origin support

## API Endpoints

### TVBox Config

**GET** `/api/tvbox`

Parameters:
- `format`: `json` (default) or `base64`

Response:
```json
{
  "sites": [...],
  "parses": [...],
  "flags": [...],
  "ads": [...],
  "wallpaper": "...",
  "lives": [...]
}
```

### Video Parse

**GET** `/api/parse`

Parameters:
- `url`: Video URL (required)
- `parser`: Parser name (optional)
- `format`: `json`, `redirect`, or `iframe` (optional, default `json`)

Supported platforms: qq.com, iqiyi.com, youku.com, mgtv.com, bilibili.com, sohu.com, letv.com, tudou.com, pptv.com, 1905.com

### Configuration Updates

When you add, modify, or remove video sources in KatelyaTV:

1. TVBox config auto-syncs with the latest source info
2. Refresh config in TVBox to get updated sources
3. No manual config link update needed

### Notes

- Ensure the TVBox device can reach your KatelyaTV server
- HTTPS recommended for security
- Config cached for 1 hour; refresh TVBox config for immediate updates
- Compatible with TVBox and derivative applications
