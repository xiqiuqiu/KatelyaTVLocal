# ADR 0006: Unify Apple playback on hls.js + ManagedMediaSource (retire the native HLS runtime)

## Status

Accepted

## Context

Apple mobile devices (iPhone/iPad) currently play through the browser's
native HLS engine (`<video src=m3u8>`), selected by
`detectAppleNativeHlsEnvironment` and expressed as `runtime: 'native-hls'` /
`recoveryProfile: 'native-video'` in `resolveHlsPlaybackPolicy`. Android and
desktop play through hls.js.

Native HLS is a black box: it emits only coarse `waiting/stalled/suspend`
events, no fragment-level signals. This forces a large Apple-only apparatus —
the Native Recovery Decision Tree, a 3s watchdog with a 30s hard-stall
threshold, jitter/rollback detection, post-ad-skip stall re-arming, and
seek-based recovery — and still yields, in practice:

- Slow stall detection and slow automatic source switching on iOS.
- Unobservable playback (the whole `native-video-recovery.ts` surface exists to
  compensate for missing signals).
- Distorted, device-dependent speed readings on the source card (hls.js
  first-fragment probing behaves differently under iOS Safari media
  restrictions), which misleads source selection.
- Two divergent runtime/recovery code paths (Apple-native vs hls.js) to
  maintain.

hls.js 1.6.16 is already installed and supports `ManagedMediaSource` (MMS,
enabled by default). On iOS/iPadOS 17.1+, `Hls.isSupported()` is true via MMS,
so Apple mobile devices can run hls.js and regain fragment-level errors, bandwidth
estimation, level switching, and the shared recovery ladder — the same engine
Android already uses.

## Decision

Make hls.js + ManagedMediaSource the single playback runtime on iPhone/iPad,
and **remove the native HLS runtime entirely**.

- iPhone/iPad devices that support MMS (`'ManagedMediaSource' in window` and
  `Hls.isSupported()`, i.e. iOS/iPadOS 17.1+) play through hls.js, converging
  with Android on one engine and one recovery model.
- The Native Recovery Decision Tree and its supporting apparatus (native
  watchdog, jitter/severity detection, `recoveryProfile: 'native-video'`,
  `apple-native-hls-ios-skip`, post-ad-skip native arming) are retired. iOS
  stall/error evidence flows through the hls.js adapter into the shared
  Playback Recovery Stage (R0–R3); no runtime keeps a private ladder.
- There is **no native fallback and no kill-switch**. iPhone/iPad devices without MMS
  (iOS ≤ 16; iPhone X/8 and earlier) cannot play and are shown a dedicated
  `device-unsupported` error state prompting an upgrade to iOS 17.1+.
- **AirPlay is dropped** on the web player: MMS requires
  `video.disableRemotePlayback = true`, and hls.js cannot feed an AirPlay
  receiver.
- The Apple runtime reuses Android's hls.js buffer configuration (unified
  parameters) rather than a separate conservative profile. Thermal, memory, and
  cellular-data impact on iPhone is a validation risk to check with the existing
  thermal probes, not a reason to diverge parameters up front.
- Telemetry gains an `apple-hlsjs` platform tag (replacing `apple-native`) so
  recovery evidence, playback feedback, and debug logs still distinguish Apple
  from Android.

Scope boundary: this decision covers only the runtime-engine swap. The
platform-neutral (Range-based) speed measurement and platform-isolated source
ranking discussed alongside it are deliberately deferred to separate changes so
that A/B attribution and rollback stay clean.

Validation gate before merge to `main`: `pnpm typecheck` and the full Jest suite
green; a real iOS 17.1+ device smoke test (startup, episode switch, stall
recovery, source switch); confirmation that an unsupported iOS version lands on
`device-unsupported` rather than a blank screen; and a thermal/memory check via
the thermal probes.

## Consequences

- iOS gains fragment-level recovery, accurate bandwidth/quality readings, and
  full observability, aligning its behaviour and code path with Android.
- A large Apple-only code surface (`native-video-recovery.ts` and its wiring in
  the play page) is deleted, collapsing two runtimes into one.
- Users on iOS ≤ 16 (iPhone X/8 and earlier) lose all playback and see an
  upgrade prompt; this is an accepted, hard-to-reverse trade-off.
- All iPhone/iPad users lose AirPlay from the web player.
- Because there is no native fallback or kill-switch, a serious hls.js/MMS
  regression on iOS can only be resolved by redeploying — accepted given the
  goal of a single maintained runtime.
- The `apple-hlsjs` platform tag preserves Apple-vs-Android attribution and
  seeds the deferred platform-isolated ranking work.
- Android and desktop playback are unchanged; the change is confined to the
  Apple branch of the playback policy and player setup.
