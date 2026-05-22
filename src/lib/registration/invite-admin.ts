import { D1DatabaseLike, getD1Database } from '@/lib/d1';

export interface RegistrationInvite {
  code: string;
  maxUses: number;
  usedCount: number;
  disabled: boolean;
  expiresAt: number | null;
  createdAt: number;
  updatedAt: number;
}

interface RegistrationInviteRow {
  code: string;
  max_uses: number;
  used_count: number;
  disabled: number;
  expires_at: number | null;
  created_at: number;
  updated_at: number;
}

export interface CreateRegistrationInviteInput {
  maxUses?: number;
  expiresAt?: number | null;
  env?: Record<string, unknown>;
  now?: number;
  code?: string;
}

export interface DisableRegistrationInviteInput {
  code: string;
  env?: Record<string, unknown>;
  now?: number;
}

function getInviteDatabase(
  env?: Record<string, unknown>
): D1DatabaseLike | null {
  return getD1Database(env);
}

function normalizeInvite(row: RegistrationInviteRow): RegistrationInvite {
  return {
    code: row.code,
    maxUses: Number(row.max_uses) || 0,
    usedCount: Number(row.used_count) || 0,
    disabled: Boolean(row.disabled),
    expiresAt: row.expires_at ?? null,
    createdAt: Number(row.created_at) || 0,
    updatedAt: Number(row.updated_at) || 0,
  };
}

function generateInviteCode(): string {
  const bytes = new Uint8Array(12);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((byte) => byte.toString(36).padStart(2, '0'))
    .join('')
    .slice(0, 18)
    .toUpperCase();
}

export async function listRegistrationInvites(
  input: { env?: Record<string, unknown>; limit?: number } = {}
): Promise<RegistrationInvite[]> {
  const db = getInviteDatabase(input.env);
  if (!db) {
    throw new Error('邀请码存储未配置');
  }

  const limit = Math.min(Math.max(input.limit ?? 50, 1), 200);
  const result = await db
    .prepare(
      `SELECT code, max_uses, used_count, disabled, expires_at, created_at, updated_at
       FROM registration_invites
       ORDER BY created_at DESC
       LIMIT ?`
    )
    .bind(limit)
    .all<RegistrationInviteRow>();

  return (result.results || []).map(normalizeInvite);
}

export async function createRegistrationInvite(
  input: CreateRegistrationInviteInput = {}
): Promise<RegistrationInvite> {
  const db = getInviteDatabase(input.env);
  if (!db) {
    throw new Error('邀请码存储未配置');
  }

  const now = input.now ?? Date.now();
  const code = (input.code || generateInviteCode()).trim().toUpperCase();
  const maxUses = Math.min(Math.max(Number(input.maxUses ?? 1), 1), 1000);
  const expiresAt =
    typeof input.expiresAt === 'number' && input.expiresAt > now
      ? input.expiresAt
      : null;

  await db
    .prepare(
      `INSERT INTO registration_invites
       (code, max_uses, used_count, disabled, expires_at, created_at, updated_at)
       VALUES (?, ?, 0, 0, ?, ?, ?)`
    )
    .bind(code, maxUses, expiresAt, now, now)
    .run();

  return {
    code,
    maxUses,
    usedCount: 0,
    disabled: false,
    expiresAt,
    createdAt: now,
    updatedAt: now,
  };
}

export async function disableRegistrationInvite(
  input: DisableRegistrationInviteInput
): Promise<void> {
  const db = getInviteDatabase(input.env);
  if (!db) {
    throw new Error('邀请码存储未配置');
  }

  const now = input.now ?? Date.now();
  await db
    .prepare(
      `UPDATE registration_invites
       SET disabled = 1, updated_at = ?
       WHERE code = ?`
    )
    .bind(now, input.code.trim().toUpperCase())
    .run();
}
