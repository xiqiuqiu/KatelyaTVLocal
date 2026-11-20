// Runs only against an ephemeral local D1 database; only source responses are mocked.
import assert from 'node:assert/strict';
import { readFileSync, realpathSync } from 'node:fs';
import { createRequire } from 'node:module';

const adapter = createRequire(
  realpathSync('node_modules/@cloudflare/next-on-pages/package.json')
);
const wrangler = createRequire(adapter.resolve('wrangler/package.json'));
const { Miniflare } = wrangler('miniflare');
const { outputFiles } = await wrangler('esbuild').build({
  entryPoints: ['src/lib/library-refresh.ts'],
  bundle: true,
  format: 'esm',
  write: false,
});
const { refreshD1Library } = await import(
  'data:text/javascript;base64,' +
    Buffer.from(outputFiles[0].contents).toString('base64')
);
const mf = new Miniflare({
  modules: true,
  script:
    "export default {fetch(req){return new Response(new Request('https://example.invalid',{redirect:new URL(req.url).searchParams.get('redirect')}).redirect)}}",
  d1Databases: ['DB'],
});
try {
  const db = await mf.getD1Database('DB');
  const sqlFile = (path) => readFileSync(path, 'utf8');
  const ddl = [
    sqlFile('docs/D1初始化.md').split('```')[1].slice(3),
    ...[
      '2026-05-28_play_records_optimization',
      '2026-07-14_play_records_route_preferences',
      '2026-11-20_library_refresh_cursor',
    ].map((n) => sqlFile('migrations/' + n + '.sql')),
  ];
  for (const sql of ddl
    .join('\n')
    .replace(/^\s*--.*$/gm, '')
    .split(';')
    .filter((s) => s.trim()))
    await db.prepare(sql).run();
  const users = ['a', 'b', 'c'];
  for (const user of users)
    await db
      .prepare("INSERT INTO users(username,password) VALUES (?,'fixture')")
      .bind(user)
      .run();
  async function seed(table, id, index) {
    const extra =
      table === 'favorites' ? '' : ',index_episode,play_time,total_time';
    const values = table === 'favorites' ? '' : ',1,17,500';
    await db
      .prepare(
        `INSERT INTO ${table}(username,key,title,year,cover,source_name,total_episodes,save_time${extra})
      VALUES(?,?,?,'2026','','mock',1,1${values})`
      )
      .bind(users[index % 3], 'mock+' + id, id)
      .run();
  }
  for (let i = 1; i <= 7; i++) await seed('play_records', 'H' + i, i);
  for (let i = 1; i <= 5; i++) await seed('favorites', 'F' + i, i);

  let reads = 0,
    writes = 0;
  function track(result) {
    reads += result.meta.rows_read;
    writes += result.meta.rows_written;
    return result;
  }
  const metered = {
    prepare: (sql) => ({
      bind: (...args) => {
        const stmt = db.prepare(sql).bind(...args);
        return {
          first: async () => track(await stmt.all()).results[0],
          all: async () => track(await stmt.all()),
          run: async () => track(await stmt.run()),
        };
      },
    }),
  };
  track(
    await db.prepare('SELECT username FROM users ORDER BY created_at ASC').all()
  );
  for (const user of users) {
    track(
      await db
        .prepare(
          'SELECT * FROM play_records WHERE username=? ORDER BY save_time DESC LIMIT 50'
        )
        .bind(user)
        .all()
    );
    track(
      await db
        .prepare(
          'SELECT * FROM favorites WHERE username=? ORDER BY save_time DESC'
        )
        .bind(user)
        .all()
    );
  }
  console.log('old selection', { reads, writes });
  for (const [round, expected] of [
    ['H1', 'F1', 'H2', 'F2'],
    ['H3', 'F3', 'H4', 'F4'],
    ['H5', 'F5', 'H6', 'H7'],
    ['H1', 'F1', 'H2', 'F2'],
    ['H3', 'F3', 'H4', 'F4'],
    ['H5', 'F5', 'H6', 'F6'],
    ['H7'],
  ].entries()) {
    reads = writes = 0;
    const seen = [];
    const result = await refreshD1Library(metered, async ({ id, redirect }) => {
      assert.equal(redirect, 'manual');
      if (round === 0 && !seen.length) {
        const checked = await mf.dispatchFetch(
          'http://local/?redirect=' + redirect
        );
        assert.equal(await checked.text(), redirect);
      }
      seen.push(id);
      if (round === 0 && id === 'H1')
        assert.equal(
          (await refreshD1Library(db, () => assert.fail())).status,
          'busy'
        );
      if (id === 'F3') throw Error('fixture source offline');
      return {
        title: id,
        year: '2026',
        poster: '',
        episodes: id === 'H2' ? ['1', '2'] : ['1'],
      };
    });
    assert.deepEqual(seen, expected);
    assert.deepEqual(result.usage, { rowsRead: reads, rowsWritten: writes });
    assert.equal(result.updated, Number(round === 0));
    assert.equal(result.failures, Number(seen.includes('F3')));
    console.log('round', round + 1, seen.join(' '), {
      reads,
      writes,
      updated: result.updated,
    });
    if (round === 0) await seed('favorites', 'F6', 6);
  }
} finally {
  await mf.dispose();
}
