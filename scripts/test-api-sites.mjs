import fs from 'node:fs';

// Usage:
//   node scripts/test-api-sites.mjs
//   node scripts/test-api-sites.mjs config.json 庆余年
//   node scripts/test-api-sites.mjs config.json 庆余年 25000
//
// Arguments:
//   1. Config file path. Default: config.json
//   2. Search keyword. Default: 庆余年
//   3. Timeout in milliseconds for each API. Default: 10000
//
// Result:
//   OK means the API returned at least one video item for the keyword.
//   FAIL means the API did not return usable video content or request failed.
//   SUMMARY shows how many APIs passed or failed.

const configPath = process.argv[2] || 'config.json';
const keyword = process.argv[3] || '\u5e86\u4f59\u5e74';
const timeoutMs = Number(process.argv[4] || 10000);

function getSites(raw) {
  try {
    const config = JSON.parse(raw);
    return Object.entries(config.api_site || {}).map(([key, site]) => ({
      key,
      api: site.api,
    }));
  } catch {
    const matches = raw.matchAll(
      /"(?<key>[^"]+)"\s*:\s*\{\s*"api"\s*:\s*"(?<api>[^"]+)"/gs
    );
    return Array.from(matches, (match) => ({
      key: match.groups.key,
      api: match.groups.api,
    }));
  }
}

async function probe(site) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const url = `${site.api}?ac=videolist&wd=${encodeURIComponent(keyword)}`;

  try {
    const response = await fetch(url, {
      headers: {
        'user-agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        accept: 'application/json',
      },
      signal: controller.signal,
    });
    const text = await response.text();
    const data = JSON.parse(text);
    const list = Array.isArray(data.list) ? data.list : [];

    return {
      ...site,
      ok: response.ok && list.length > 0,
      status: response.status,
      count: list.length,
      sample: list[0]?.vod_name || '',
    };
  } catch (error) {
    return {
      ...site,
      ok: false,
      status: 0,
      count: 0,
      sample: error instanceof Error ? error.message : String(error),
    };
  } finally {
    clearTimeout(timer);
  }
}

const raw = fs.readFileSync(configPath, 'utf8');
const sites = getSites(raw);
const results = await Promise.all(sites.map(probe));

for (const result of results) {
  const status = result.ok ? 'OK' : 'FAIL';
  console.log(
    `${status}\t${result.key}\t${result.count}\t${result.sample}\t${result.api}`
  );
}

const failed = results.filter((result) => !result.ok);
console.log(`SUMMARY ok=${results.length - failed.length} fail=${failed.length}`);

if (failed.length > 0) {
  process.exitCode = 1;
}
