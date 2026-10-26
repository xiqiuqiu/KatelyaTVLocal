import { z } from 'zod';

export const PLAYBACK_QUALITY_MAX_BODY_BYTES = 16 * 1024;
export const PLAYBACK_QUALITY_MAX_SEQ = 16;

const duration = z.number().finite().min(0).max(86_400_000);
const nullableDuration = duration.nullable();
const nullableKey = z.string().trim().min(1).max(512).nullable();

export const playbackQualityRecordSchema = z
  .object({
    sessionId: z.string().regex(/^[\w-]{1,80}$/),
    roundId: z.number().int().min(1).max(100),
    rootRoundId: z.number().int().min(1).max(100),
    rowKind: z.enum(['round', 'source']),
    attemptId: z.number().int().min(0).max(1000),
    seq: z.number().int().min(1).max(PLAYBACK_QUALITY_MAX_SEQ),
    status: z.enum(['pending', 'terminal']),
    outcome: z
      .enum([
        'frame-ready',
        'source-timeout',
        'network-error',
        'media-error',
        'cancelled',
        'budget-exhausted',
        'failed',
        'abandoned',
        'user-intervened',
      ])
      .nullable(),
    contentKey: nullableKey,
    episodeIndex: z.number().int().min(0).max(100_000),
    sourceKey: nullableKey,
    platform: z.enum(['apple-hlsjs', 'android-hlsjs', 'desktop-hlsjs']),
    runtime: z.literal('hlsjs'),
    entryKind: z.enum(['click', 'direct', 'episode']),
    roundReason: z.enum(['initial', 'continue', 'manual-source', 'episode']),
    sourceReason: z.enum(['initial', 'auto', 'manual']).nullable(),
    releaseId: z.string().trim().min(1).max(128),
    policyVersion: z.string().trim().min(1).max(80),
    elapsedMs: duration,
    activeWaitMs: duration,
    clickToFrameMs: nullableDuration,
    pageToFrameMs: nullableDuration,
    sourceToFrameMs: nullableDuration,
    frameEvidence: z.enum(['rvfc', 'playhead']).nullable(),
    hadHidden: z.boolean(),
    autoplayBlocked: z.boolean(),
    promptChoice: z.enum(['continue', 'manual', 'leave']).nullable(),
    nextRoundId: z.number().int().min(1).max(100).nullable(),
  })
  .strict()
  .superRefine((record, context) => {
    const invalid =
      record.rootRoundId > record.roundId ||
      (record.rowKind === 'round'
        ? record.attemptId !== 0
        : record.attemptId === 0 ||
          !record.sourceKey ||
          !record.sourceReason) ||
      (record.status === 'pending') !== (record.outcome === null) ||
      record.activeWaitMs > record.elapsedMs ||
      (record.outcome === 'frame-ready' &&
        (!record.frameEvidence || record.pageToFrameMs === null)) ||
      (record.outcome !== 'frame-ready' && record.frameEvidence !== null) ||
      (record.promptChoice !== null &&
        (record.rowKind !== 'round' ||
          record.outcome !== 'budget-exhausted')) ||
      (record.nextRoundId !== null &&
        (record.nextRoundId <= record.roundId || !record.promptChoice));
    if (invalid)
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Inconsistent playback quality record',
      });
  });

export const playbackQualityPayloadSchema = z
  .object({
    schemaVersion: z.literal(1),
    records: z.array(playbackQualityRecordSchema).min(1).max(4),
  })
  .strict();

export type PlaybackQualityRecord = z.infer<typeof playbackQualityRecordSchema>;
