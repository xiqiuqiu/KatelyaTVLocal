/* eslint-disable no-console */
import { D1DatabaseLike, getD1Database } from '@/lib/d1';

export const AUTH_AUDIT_UNKNOWN_USERNAME = '(unknown)';
export const AUTH_AUDIT_RETENTION_DAYS = 90;

export type AuthAuditEventType =
  | 'login_success'
  | 'login_failure'
  | 'logout';

export type AuthAuditFailureReason =
  | 'turnstile_failure'
  | 'rate_limited'
  | 'invalid_credentials'
  | 'invalid_username';

export type AuthAuditDeviceClass =
  | 'desktop'
  | 'mobile'
  | 'tablet'
  | 'bot'
  | 'unknown';

export interface AuthAuditEvent {
  id: number;
  eventType: AuthAuditEventType;
  username: string;
  failureReason: AuthAuditFailureReason | null;
  ipRedacted: string | null;
  deviceClass: AuthAuditDeviceClass | null;
  createdAt: number;
}

export interface RecordAuthAuditEventInput {
  eventType: AuthAuditEventType;
  username?: string | null;
  failureReason?: AuthAuditFailureReason | null;
  ip?: string | null;
  userAgent?: string | null;
  now?: number;
  env?: Record<string, unknown>;
}

export interface ListAuthAuditEventsInput {
  username?: string;
  eventType?: AuthAuditEventType;
  from?: number;
  to?: number;
  limit?: number;
  env?: Record<string, unknown>;
}

export type ListAuthAuditEventsResult =
  | { available: false; reason: 'd1_unavailable' }
  | { available: true; events: AuthAuditEvent[] };

export interface PurgeExpiredAuthAuditEventsInput {
  now?: number;
  retentionDays?: number;
  env?: Record<string, unknown>;
}

export type PurgeExpiredAuthAuditEventsResult =
  | { available: false; reason: 'd1_unavailable' }
  | { available: true; deleted: number };

interface AuthAuditRow {
  id: number;
  event_type: string;
  username: string;
  failure_reason: string | null;
  ip_redacted: string | null;
  device_class: string | null;
  created_at: number;
}

function getAuthAuditDatabase(
  env?: Record<string, unknown>
): D1DatabaseLike | null {
  return getD1Database(env);
}

export function normalizeAuthAuditUsername(
  username: string | null | undefined
): string {
  if (typeof username !== 'string') {
    return AUTH_AUDIT_UNKNOWN_USERNAME;
  }
  const trimmed = username.trim();
  return trimmed || AUTH_AUDIT_UNKNOWN_USERNAME;
}

export function redactIp(ip: string | null | undefined): string | null {
  if (typeof ip !== 'string') {
    return null;
  }
  const trimmed = ip.trim();
  if (!trimmed) {
    return null;
  }

  if (trimmed.includes(':')) {
    const withoutZone = trimmed.split('%')[0] || trimmed;
    const expanded = expandIpv6ForRedaction(withoutZone);
    if (!expanded) {
      return 'unknown';
    }
    const hextets = expanded.split(':').slice(0, 4);
    let end = hextets.length;
    while (end > 1 && hextets[end - 1] === '0') {
      end -= 1;
    }
    return `${hextets.slice(0, end).join(':')}::/64`;
  }

  const parts = trimmed.split('.');
  if (parts.length === 4 && parts.every((part) => /^\d{1,3}$/.test(part))) {
    return `${parts[0]}.${parts[1]}.${parts[2]}.0/24`;
  }

  return 'unknown';
}

function expandIpv6ForRedaction(ip: string): string | null {
  const lower = ip.toLowerCase();
  if (lower === '::') {
    return '0:0:0:0:0:0:0:0';
  }

  const [head = '', tail = ''] = lower.split('::');
  const headParts = head ? head.split(':').filter(Boolean) : [];
  const tailParts = tail ? tail.split(':').filter(Boolean) : [];
  const missing = 8 - headParts.length - tailParts.length;
  if (missing < 0) {
    return null;
  }

  const full = [
    ...headParts,
    ...Array.from({ length: missing }, () => '0'),
    ...tailParts,
  ];
  if (full.length !== 8) {
    return null;
  }

  return full.join(':');
}

export function classifyDeviceClass(
  userAgent: string | null | undefined
): AuthAuditDeviceClass {
  if (typeof userAgent !== 'string' || !userAgent.trim()) {
    return 'unknown';
  }

  const ua = userAgent;
  if (/bot|crawler|spider|curl|wget|python-requests|httpclient/i.test(ua)) {
    return 'bot';
  }
  if (/iPad|Tablet|Android(?!.*Mobile)/i.test(ua)) {
    return 'tablet';
  }
  if (/Mobile|iPhone|iPod|Android.*Mobile/i.test(ua)) {
    return 'mobile';
  }
  if (/Mozilla|Chrome|Safari|Firefox|Edg|Macintosh|Windows NT|Linux/i.test(ua)) {
    return 'desktop';
  }

  return 'unknown';
}

function mapRow(row: AuthAuditRow): AuthAuditEvent {
  return {
    id: row.id,
    eventType: row.event_type as AuthAuditEventType,
    username: row.username,
    failureReason: (row.failure_reason as AuthAuditFailureReason | null) || null,
    ipRedacted: row.ip_redacted,
    deviceClass: (row.device_class as AuthAuditDeviceClass | null) || null,
    createdAt: row.created_at,
  };
}

export async function recordAuthAuditEvent(
  input: RecordAuthAuditEventInput
): Promise<{ recorded: boolean }> {
  const db = getAuthAuditDatabase(input.env);
  if (!db) {
    return { recorded: false };
  }

  const username = normalizeAuthAuditUsername(input.username);
  const failureReason =
    input.eventType === 'login_failure' ? input.failureReason ?? null : null;
  const now = input.now ?? Date.now();

  try {
    await db
      .prepare(
        `INSERT INTO auth_audit_events
         (event_type, username, failure_reason, ip_redacted, device_class, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .bind(
        input.eventType,
        username,
        failureReason,
        redactIp(input.ip),
        classifyDeviceClass(input.userAgent),
        now
      )
      .run();
    return { recorded: true };
  } catch (error) {
    console.error('auth audit write failed', error);
    return { recorded: false };
  }
}

export async function listAuthAuditEvents(
  input: ListAuthAuditEventsInput = {}
): Promise<ListAuthAuditEventsResult> {
  const db = getAuthAuditDatabase(input.env);
  if (!db) {
    return { available: false, reason: 'd1_unavailable' };
  }

  const clauses: string[] = [];
  const values: unknown[] = [];

  if (typeof input.username === 'string' && input.username.trim()) {
    clauses.push('username = ?');
    values.push(input.username.trim());
  }
  if (input.eventType) {
    clauses.push('event_type = ?');
    values.push(input.eventType);
  }
  if (typeof input.from === 'number' && Number.isFinite(input.from)) {
    clauses.push('created_at >= ?');
    values.push(input.from);
  }
  if (typeof input.to === 'number' && Number.isFinite(input.to)) {
    clauses.push('created_at <= ?');
    values.push(input.to);
  }

  const limit = Math.min(
    500,
    Math.max(
      1,
      Number.isFinite(input.limit) && input.limit
        ? Math.floor(input.limit)
        : 100
    )
  );
  values.push(limit);

  const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';

  try {
    const result = await db
      .prepare(
        `SELECT id, event_type, username, failure_reason, ip_redacted, device_class, created_at
         FROM auth_audit_events
         ${where}
         ORDER BY created_at DESC, id DESC
         LIMIT ?`
      )
      .bind(...values)
      .all<AuthAuditRow>();

    return {
      available: true,
      events: (result.results || []).map(mapRow),
    };
  } catch (error) {
    console.error('auth audit list failed', error);
    return { available: false, reason: 'd1_unavailable' };
  }
}

export async function purgeExpiredAuthAuditEvents(
  input: PurgeExpiredAuthAuditEventsInput = {}
): Promise<PurgeExpiredAuthAuditEventsResult> {
  const db = getAuthAuditDatabase(input.env);
  if (!db) {
    return { available: false, reason: 'd1_unavailable' };
  }

  const retentionDays = input.retentionDays ?? AUTH_AUDIT_RETENTION_DAYS;
  const now = input.now ?? Date.now();
  const cutoff = now - retentionDays * 24 * 60 * 60 * 1000;

  try {
    const result = await db
      .prepare('DELETE FROM auth_audit_events WHERE created_at < ?')
      .bind(cutoff)
      .run();
    const deleted =
      result &&
      typeof result === 'object' &&
      'meta' in result &&
      result.meta &&
      typeof result.meta === 'object' &&
      'changes' in result.meta
        ? Number((result.meta as { changes?: number }).changes || 0)
        : 0;

    return { available: true, deleted };
  } catch (error) {
    console.error('auth audit purge failed', error);
    return { available: false, reason: 'd1_unavailable' };
  }
}
