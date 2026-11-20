import type { D1DatabaseLike } from './d1';
import type { fetchVideoDetail } from './fetchVideoDetail';
import { parsePlayRecordKey } from './play-record-key';

// Each detail can fall back to one search. Four slots allow at most eight external requests.
const BATCH_SIZE = 4;
type Table = 'play_records' | 'favorites';
interface Candidate {
  rid: number;
  username: string;
  key: string;
  title: string;
  total_episodes: number;
  save_time: number;
  route_source: string | null;
  route_id: string | null;
}
interface Cursor {
  history_after: number;
  favorite_after: number;
  history_end: number;
  favorite_end: number;
}

export async function refreshD1Library(
  db: D1DatabaseLike,
  detail: typeof fetchVideoDetail
) {
  const usage = { rowsRead: 0, rowsWritten: 0 };
  function measured<
    T extends { meta?: { rows_read?: number; rows_written?: number } }
  >(result: T) {
    usage.rowsRead += result.meta?.rows_read ?? 0;
    usage.rowsWritten += result.meta?.rows_written ?? 0;
    return result;
  }
  const now = Date.now();
  const lease = now + 5 * 60_000;
  // Keep the high-water marks until both tables finish, even when new rows are inserted.
  const claim = await db
    .prepare(
      `UPDATE library_refresh_cursor SET lease_until=?,
    history_end=CASE WHEN history_after=0 AND favorite_after=0 THEN COALESCE((SELECT MAX(rowid) FROM play_records),0) ELSE history_end END,
    favorite_end=CASE WHEN history_after=0 AND favorite_after=0 THEN COALESCE((SELECT MAX(rowid) FROM favorites),0) ELSE favorite_end END
    WHERE id=1 AND lease_until<=? RETURNING history_after,favorite_after,history_end,favorite_end`
    )
    .bind(lease, now)
    .all<Cursor>();
  const cursor = measured(claim).results?.[0];
  if (!cursor) return { status: 'busy', usage };

  async function page(table: Table, after: number, end: number) {
    if (after >= end) return [];
    const route =
      table === 'play_records'
        ? 'route_source,route_id'
        : 'NULL AS route_source,NULL AS route_id';
    const rows = await db
      .prepare(
        `SELECT rowid AS rid,username,key,title,total_episodes,save_time,${route} FROM ${table}
      WHERE rowid>? AND rowid<=? ORDER BY rowid LIMIT ?`
      )
      .bind(after, end, BATCH_SIZE)
      .all<Candidate>();
    return measured(rows).results ?? [];
  }
  const [history, favorites] = await Promise.all([
    page('play_records', cursor.history_after, cursor.history_end),
    page('favorites', cursor.favorite_after, cursor.favorite_end),
  ]);
  let processed = 0,
    failures = 0,
    updated = 0;
  const cache = new Map<string, ReturnType<typeof fetchVideoDetail>>();
  async function refresh(table: Table, row: Candidate) {
    processed++;
    const route =
      row.key.startsWith('wp:') && row.route_source && row.route_id
        ? { source: row.route_source, id: row.route_id }
        : parsePlayRecordKey(row.key);
    if (!route) return;
    const key = JSON.stringify([route.source, route.id]);
    let found = cache.get(key);
    if (!found) {
      found = detail({ ...route, fallbackTitle: row.title, redirect: 'error' });
      cache.set(key, found);
    }
    const result = await found.catch(() => null);
    if (!result) {
      failures++;
      return;
    }
    const count = result.episodes.length;
    if (!count || count === row.total_episodes) return;
    // Never recreate a deleted item or overwrite a newer playback position/route.
    const changed = await db
      .prepare(
        `UPDATE ${table} SET total_episodes=?,title=COALESCE(NULLIF(?,''),title),
      year=COALESCE(NULLIF(?,''),year),cover=COALESCE(NULLIF(?,''),cover)
      WHERE rowid=? AND username=? AND key=? AND save_time=? AND total_episodes=?
      ${
        table === 'play_records'
          ? 'AND route_source IS ? AND route_id IS ?'
          : ''
      }`
      )
      .bind(
        count,
        row.key.startsWith('wp:') ? '' : result.title,
        row.key.startsWith('wp:') ? '' : result.year,
        result.poster,
        row.rid,
        row.username,
        row.key,
        row.save_time,
        row.total_episodes,
        ...(table === 'play_records' ? [row.route_source, row.route_id] : [])
      )
      .all();
    updated += measured(changed).meta?.changes ?? 0;
  }
  // Alternate while both tables have work; spare slots go to the other table.
  for (
    let i = 0;
    processed < BATCH_SIZE && (i < history.length || i < favorites.length);
    i++
  ) {
    if (history[i]) {
      await refresh('play_records', history[i]);
      cursor.history_after = history[i].rid;
    }
    if (favorites[i] && processed < BATCH_SIZE) {
      await refresh('favorites', favorites[i]);
      cursor.favorite_after = favorites[i].rid;
    }
  }
  // Deleted tail rows must not strand the cursor at an unreachable high-water mark.
  if (
    history.length < BATCH_SIZE &&
    (!history.length ||
      cursor.history_after === history[history.length - 1].rid)
  )
    cursor.history_after = cursor.history_end;
  if (
    favorites.length < BATCH_SIZE &&
    (!favorites.length ||
      cursor.favorite_after === favorites[favorites.length - 1].rid)
  )
    cursor.favorite_after = cursor.favorite_end;
  const wrapped =
    cursor.history_after === cursor.history_end &&
    cursor.favorite_after === cursor.favorite_end;
  const checkpoint = await db
    .prepare(
      `UPDATE library_refresh_cursor SET history_after=?,favorite_after=?,lease_until=0 WHERE id=1 AND lease_until=?`
    )
    .bind(
      wrapped ? 0 : cursor.history_after,
      wrapped ? 0 : cursor.favorite_after,
      lease
    )
    .all();
  measured(checkpoint);
  return {
    usage,
    status: 'completed',
    processed,
    details: cache.size,
    failures,
    updated,
    wrapped,
  };
}
