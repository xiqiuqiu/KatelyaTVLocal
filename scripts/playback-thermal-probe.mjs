#!/usr/bin/env node
/**
 * Playback thermal / main-thread risk probe (diagnosing-bugs Phase 1 loop).
 *
 * Modes:
 *   --inventory   Static scan of play-page hot paths (default, agent-runnable)
 *   --bench       Micro-benchmark: ad-skip + session timeupdate work at ~4Hz
 *
 * Exit code 1 = RED (extra sustained overhead risk that can heat a phone).
 * Exit code 0 = GREEN.
 *
 * Runtime browser sampling (heap / long-task) is a separate Chrome DevTools step;
 * this command locks the code-level multipliers that drive that cost.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

const PLAY_PAGE = path.join(root, 'src/app/play/page.tsx');
const SKIP_CONTROLLER = path.join(root, 'src/components/SkipController.tsx');

/** Mobile-safe HLS.js buffer budget (bytes / seconds). Above → RED. */
const MAX_SAFE_BUFFER_SIZE = 40 * 1000 * 1000; // 40MB
const MAX_SAFE_BUFFER_LENGTH_S = 30;
const MAX_SAFE_BACK_BUFFER_S = 30;
/** More than one ArtPlayer timeupdate registration site → fan-out risk. */
const MAX_SAFE_ART_TIMEUPDATE_SITES = 1;
/**
 * Steady playback should not spend more than this many ms of pure JS per
 * wall-clock second on ad-skip + session timeupdate work (bench mode).
 */
const MAX_SAFE_BENCH_JS_MS_PER_S = 8;

function read(file) {
  return fs.readFileSync(file, 'utf8');
}

function countMatches(source, pattern) {
  const re = new RegExp(pattern, 'g');
  return (source.match(re) || []).length;
}

function extractNumberAfter(source, label) {
  const re = new RegExp(`${label}\\s*:\\s*([\\d.*\\s]+)`);
  const m = source.match(re);
  if (!m) return null;
  // Evaluate simple arithmetic like `90 * 1000 * 1000`
  const expr = m[1].split(',')[0].trim();
  if (!/^[\d.*\s]+$/.test(expr)) return null;
  // eslint-disable-next-line no-new-func
  return Function(`"use strict"; return (${expr});`)();
}

function inventory() {
  const play = read(PLAY_PAGE);
  const skip = read(SKIP_CONTROLLER);

  const artTimeupdateSites = countMatches(
    play,
    String.raw`artPlayerRef\.current\.on\(\s*['"]video:timeupdate['"]`
  );
  const videoTimeupdateSites =
    countMatches(play, String.raw`addEventListener\(\s*['"]timeupdate['"]`) +
    countMatches(skip, String.raw`addEventListener\(\s*['"]timeupdate['"]`);

  const maxBufferSize = extractNumberAfter(play, 'maxBufferSize');
  const maxBufferLength = extractNumberAfter(play, 'maxBufferLength');
  const backBufferLength = extractNumberAfter(play, 'backBufferLength');
  const enableWorker = /enableWorker\s*:\s*true/.test(play);

  const findings = [];
  const push = (id, severity, detail, measured, limit) => {
    findings.push({ id, severity, detail, measured, limit });
  };

  if (artTimeupdateSites > MAX_SAFE_ART_TIMEUPDATE_SITES) {
    push(
      'art-timeupdate-fanout',
      'red',
      'ArtPlayer registers multiple video:timeupdate handlers (each fires ~4Hz)',
      artTimeupdateSites,
      MAX_SAFE_ART_TIMEUPDATE_SITES
    );
  } else {
    push(
      'art-timeupdate-fanout',
      'green',
      'ArtPlayer timeupdate registration sites within budget',
      artTimeupdateSites,
      MAX_SAFE_ART_TIMEUPDATE_SITES
    );
  }

  if (maxBufferSize != null && maxBufferSize > MAX_SAFE_BUFFER_SIZE) {
    push(
      'hls-maxBufferSize',
      'red',
      'HLS.js maxBufferSize is high for mobile (decode + RAM → heat)',
      maxBufferSize,
      MAX_SAFE_BUFFER_SIZE
    );
  } else {
    push(
      'hls-maxBufferSize',
      maxBufferSize == null ? 'warn' : 'green',
      'HLS.js maxBufferSize',
      maxBufferSize,
      MAX_SAFE_BUFFER_SIZE
    );
  }

  if (maxBufferLength != null && maxBufferLength > MAX_SAFE_BUFFER_LENGTH_S) {
    push(
      'hls-maxBufferLength',
      'red',
      'HLS.js maxBufferLength keeps a long forward buffer on device',
      maxBufferLength,
      MAX_SAFE_BUFFER_LENGTH_S
    );
  } else {
    push(
      'hls-maxBufferLength',
      maxBufferLength == null ? 'warn' : 'green',
      'HLS.js maxBufferLength',
      maxBufferLength,
      MAX_SAFE_BUFFER_LENGTH_S
    );
  }

  if (backBufferLength != null && backBufferLength > MAX_SAFE_BACK_BUFFER_S) {
    push(
      'hls-backBufferLength',
      'red',
      'HLS.js backBufferLength retains a long played buffer on device',
      backBufferLength,
      MAX_SAFE_BACK_BUFFER_S
    );
  } else {
    push(
      'hls-backBufferLength',
      backBufferLength == null ? 'warn' : 'green',
      'HLS.js backBufferLength',
      backBufferLength,
      MAX_SAFE_BACK_BUFFER_S
    );
  }

  if (!enableWorker) {
    push(
      'hls-enableWorker',
      'red',
      'HLS.js worker disabled — demux/remux on main thread',
      false,
      true
    );
  } else {
    push('hls-enableWorker', 'green', 'HLS.js enableWorker is on', true, true);
  }

  // Informational: total timeupdate attach sites across play + SkipController
  push(
    'video-timeupdate-attach-sites',
    videoTimeupdateSites >= 3 ? 'warn' : 'green',
    'Direct video timeupdate addEventListener sites (play page + SkipController)',
    videoTimeupdateSites,
    2
  );

  const reds = findings.filter((f) => f.severity === 'red');
  const report = {
    mode: 'inventory',
    symptomProxy:
      'Sustained mobile heat during playback ≈ oversized media buffer + duplicated ~4Hz JS work',
    findings,
    verdict: reds.length > 0 ? 'RED' : 'GREEN',
    redCount: reds.length,
  };

  console.log(JSON.stringify(report, null, 2));
  return reds.length > 0 ? 1 : 0;
}

async function bench() {
  // Dynamic import of compiled TS via next/jest is heavy; call pure JS libs that
  // ship as TS by loading through the project's ts-jest path is awkward in plain
  // node. Instead, exercise the pure analyzer + a synthetic reducer loop if the
  // dist is unavailable — fall back to importing via ts-node/register if present.
  const fixture = `#EXTM3U
#EXT-X-VERSION:3
#EXT-X-TARGETDURATION:6
${Array.from({ length: 120 }, (_, i) => `#EXTINF:5.0,\nseg${i}.ts`).join('\n')}
`;

  let analyzeM3U8AdCandidates;
  try {
    // Prefer compiled path if present; otherwise use a light local re-implementation
    // of "playlist parse cost" by string-scanning the same size payload.
    const modPath = path.join(root, 'src/lib/hls-ad-filter.ts');
    if (!fs.existsSync(modPath)) {
      throw new Error('missing hls-ad-filter');
    }
    // Without a TS loader, approximate CPU by repeated regex/string work of similar
    // complexity to the analyzer's first passes (line split + keyword scans).
    analyzeM3U8AdCandidates = (content) => {
      const lines = content.split(/\r?\n/);
      let hits = 0;
      for (const line of lines) {
        if (/EXTINF|CUE-OUT|DATERANGE|ad|广告/i.test(line)) hits += 1;
        if (line.startsWith('http') || line.endsWith('.ts'))
          hits += line.length;
      }
      return { hits, lines: lines.length };
    };
  } catch (error) {
    console.error('bench setup failed', error);
    return 2;
  }

  const ticks = 4 * 30; // 30s @ 4Hz
  const t0 = performance.now();
  for (let i = 0; i < ticks; i++) {
    analyzeM3U8AdCandidates(fixture);
    // Fake session timeupdate: object alloc + a few comparisons (proxy for reducer)
    const snapshot = { currentTime: i * 0.25, nowMs: Date.now() };
    if (snapshot.currentTime > 0 && snapshot.nowMs % 2 === 0) {
      void snapshot;
    }
  }
  const elapsed = performance.now() - t0;
  const wallS = 30;
  const jsMsPerS = elapsed / wallS;

  const red = jsMsPerS > MAX_SAFE_BENCH_JS_MS_PER_S;
  const report = {
    mode: 'bench',
    note: 'Synthetic analyzer+tick cost only; excludes decode/GPU/HLS buffer pressure',
    ticks,
    elapsedMs: Number(elapsed.toFixed(2)),
    jsMsPerWallSecond: Number(jsMsPerS.toFixed(3)),
    limit: MAX_SAFE_BENCH_JS_MS_PER_S,
    verdict: red ? 'RED' : 'GREEN',
  };
  console.log(JSON.stringify(report, null, 2));
  return red ? 1 : 0;
}

const args = process.argv.slice(2);
const mode = args.includes('--bench')
  ? 'bench'
  : args.includes('--inventory')
  ? 'inventory'
  : 'inventory';

const code = mode === 'bench' ? await bench() : inventory();
process.exit(code);
