#!/usr/bin/env node
/**
 * iOS stall / recovery feedback loop (diagnosing-bugs Phase 1).
 *
 * Replays a captured playback_debug_logs session fixture and goes RED when
 * the user's exact symptom appears:
 *   - frequent R0 stall-episode churn without climbing the recovery ladder
 *   - same-source recovery blocked by Intent (seek-settled) during active stall
 *   - auto source-switch planned, but sourceChange.started mis-tagged / no R3
 *
 * Usage:
 *   node scripts/analyze-ios-stall-recovery.mjs \
 *     [--fixture scripts/fixtures/jiaye-ios-session-209f363a.events.json]
 *
 * Exit 1 = RED (symptom present). Exit 0 = GREEN.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

const DEFAULT_FIXTURE = path.join(
  root,
  'scripts/fixtures/jiaye-ios-session-209f363a.events.json'
);

/**
 * Historical fixtures (e.g. 209f363a) were captured under HEALTHY=1.5s.
 * Thrash detection uses that prod-era window so old logs stay red-capable.
 * Post-fix sessions should be checked with the Jest regression instead.
 */
const HISTORICAL_HEALTHY_SUSTAINED_MS = 1500;
/** R0 episodes ending near the healthy-sustain threshold = ladder thrash. */
const R0_THRASH_NEAR_HEALTHY_MS = HISTORICAL_HEALTHY_SUSTAINED_MS + 500;
const R0_THRASH_MIN_COUNT = 20;
/** Escalation is considered absent when R1+ stage.entered never appears. */
const MIN_R1_PLUS_STAGE_ENTERED = 1;

function parseArgs(argv) {
  let fixture = DEFAULT_FIXTURE;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--fixture' && argv[i + 1]) {
      fixture = path.resolve(argv[++i]);
    }
  }
  return { fixture };
}

function loadEvents(fixturePath) {
  const raw = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
  if (Array.isArray(raw)) return raw;
  if (Array.isArray(raw.results)) return raw.results;
  if (Array.isArray(raw?.[0]?.results)) return raw[0].results;
  throw new Error(`Unrecognized fixture shape: ${fixturePath}`);
}

function detailsOf(event) {
  if (!event?.details_json) return {};
  try {
    return JSON.parse(event.details_json);
  } catch {
    return {};
  }
}

function analyze(events) {
  const findings = [];
  const r0DurationsMs = [];
  let lastR0At = null;
  let r0Entered = 0;
  let r1PlusEntered = 0;
  let r2ResumePlanned = 0;
  let gateDeniedSeekSettled = 0;
  let autoSwitchPlanned = 0;
  let sourceChangeStarted = 0;
  let sourceChangeTaggedManual = 0;
  let sourceChangeTaggedAuto = 0;
  let waitingOrStalled = 0;
  let jitterDetected = 0;

  for (const event of events) {
    const d = detailsOf(event);
    const type = event.event_type;

    if (type === 'recovery.stage.entered') {
      const stage = d.stage;
      if (stage === 'R0') {
        r0Entered += 1;
        lastR0At = event.created_at;
      } else if (stage === 'R1' || stage === 'R2' || stage === 'R3') {
        r1PlusEntered += 1;
      }
    }

    if (type === 'recovery.stall-episode.ended') {
      if (d.previousStage === 'R0' && lastR0At != null) {
        r0DurationsMs.push(event.created_at - lastR0At);
        lastR0At = null;
      }
    }

    if (type === 'resume.planned' && d.stage === 'R2') {
      r2ResumePlanned += 1;
    }

    if (
      type === 'intent.gate.denied' &&
      d.deniedBy === 'seek-settled' &&
      d.kind === 'same-source-recovery'
    ) {
      gateDeniedSeekSettled += 1;
    }

    if (type === 'switch-source-resume-planned') {
      autoSwitchPlanned += 1;
    }

    if (type === 'sourceChange.started') {
      sourceChangeStarted += 1;
      if (d.reason === 'manual') sourceChangeTaggedManual += 1;
      if (d.reason === 'auto' || d.reason === 'automatic') {
        sourceChangeTaggedAuto += 1;
      }
    }

    if (
      type === 'native-video-waiting' ||
      type === 'native-video-stalled' ||
      type === 'native-buffer-observed'
    ) {
      waitingOrStalled += 1;
    }

    if (type === 'native-jitter-detected') {
      jitterDetected += 1;
    }
  }

  const r0NearHealthy = r0DurationsMs.filter(
    (ms) => ms > 0 && ms <= R0_THRASH_NEAR_HEALTHY_MS
  ).length;

  // Symptom A: R0 thrash — many short R0 episodes, no R1+ stage.entered
  if (
    r0NearHealthy >= R0_THRASH_MIN_COUNT &&
    r1PlusEntered < MIN_R1_PLUS_STAGE_ENTERED
  ) {
    findings.push({
      id: 'r0-thrash-no-escalation',
      severity: 'RED',
      detail:
        `R0 ended ≤${R0_THRASH_NEAR_HEALTHY_MS}ms ${r0NearHealthy}× ` +
        `(~historical HEALTHY_SUSTAINED=${HISTORICAL_HEALTHY_SUSTAINED_MS}ms) while R1+ stage.entered=${r1PlusEntered}`,
      measured: { r0NearHealthy, r1PlusEntered, r0Entered },
    });
  }

  // Symptom B: same-source recovery blocked by seek-settled during stall work
  if (gateDeniedSeekSettled > 0 && (jitterDetected > 0 || waitingOrStalled > 0)) {
    findings.push({
      id: 'same-source-recovery-seek-settled-denied',
      severity: 'RED',
      detail:
        `intent.gate.denied(seek-settled/same-source-recovery)=${gateDeniedSeekSettled} ` +
        `while jitter=${jitterDetected} waiting/stalled=${waitingOrStalled}`,
      measured: { gateDeniedSeekSettled, jitterDetected, waitingOrStalled },
    });
  }

  // Symptom C: auto switch planned but sourceChange never tagged auto / no R3
  if (
    autoSwitchPlanned > 0 &&
    sourceChangeTaggedAuto === 0 &&
    r1PlusEntered < MIN_R1_PLUS_STAGE_ENTERED
  ) {
    findings.push({
      id: 'auto-switch-misattributed-or-no-r3',
      severity: 'RED',
      detail:
        `switch-source-resume-planned=${autoSwitchPlanned} but ` +
        `sourceChange.started auto=0 (manual=${sourceChangeTaggedManual}/${sourceChangeStarted}) ` +
        `and R1+ stage.entered=${r1PlusEntered}`,
      measured: {
        autoSwitchPlanned,
        sourceChangeTaggedManual,
        sourceChangeTaggedAuto,
        sourceChangeStarted,
        r1PlusEntered,
        r2ResumePlanned,
      },
    });
  }

  // Symptom D: stutter signals present with almost no effective ladder climb
  if (
    waitingOrStalled >= 10 &&
    r0Entered >= R0_THRASH_MIN_COUNT &&
    r1PlusEntered < MIN_R1_PLUS_STAGE_ENTERED &&
    r2ResumePlanned < 3
  ) {
    findings.push({
      id: 'stutter-without-ladder-climb',
      severity: 'RED',
      detail:
        `waiting/stalled/buffer=${waitingOrStalled}, R0.entered=${r0Entered}, ` +
        `R1+ stage.entered=${r1PlusEntered}, R2 resume.planned=${r2ResumePlanned}`,
      measured: {
        waitingOrStalled,
        r0Entered,
        r1PlusEntered,
        r2ResumePlanned,
      },
    });
  }

  const reds = findings.filter((f) => f.severity === 'RED');
  return {
    verdict: reds.length > 0 ? 'RED' : 'GREEN',
    redCount: reds.length,
    summary: {
      events: events.length,
      r0Entered,
      r1PlusEntered,
      r2ResumePlanned,
      r0NearHealthy,
      r0EpisodeCount: r0DurationsMs.length,
      gateDeniedSeekSettled,
      autoSwitchPlanned,
      sourceChangeTaggedManual,
      sourceChangeTaggedAuto,
      waitingOrStalled,
      jitterDetected,
    },
    findings,
  };
}

function main() {
  const { fixture } = parseArgs(process.argv.slice(2));
  if (!fs.existsSync(fixture)) {
    console.error(
      JSON.stringify(
        {
          verdict: 'ERROR',
          error: `fixture not found: ${fixture}`,
          hint: 'Export with wrangler d1 → scripts/fixtures/*.events.json',
        },
        null,
        2
      )
    );
    process.exit(2);
  }

  const events = loadEvents(fixture);
  const report = analyze(events);
  report.fixture = path.relative(root, fixture);
  console.log(JSON.stringify(report, null, 2));
  process.exit(report.verdict === 'RED' ? 1 : 0);
}

main();
