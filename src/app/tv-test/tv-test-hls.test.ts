import fs from 'node:fs';
import path from 'node:path';

describe('TV test HLS fixture', () => {
  it('keeps every playlist and segment on the same static origin', () => {
    const root = path.join(process.cwd(), 'public/tv-test/hls');
    const master = fs.readFileSync(path.join(root, 'master.m3u8'), 'utf8');
    const variants = master
      .split('\n')
      .filter((line) => line && !line.startsWith('#'));

    expect(variants).toEqual([
      '360p/index.m3u8',
      '720p/index.m3u8',
      '1080p/index.m3u8',
    ]);

    variants.forEach((variant) => {
      const playlistPath = path.join(root, variant);
      const playlist = fs.readFileSync(playlistPath, 'utf8');
      const playlistDir = path.dirname(playlistPath);

      playlist
        .split('\n')
        .filter((line) => line && !line.startsWith('#'))
        .forEach((segment) => {
          expect(fs.existsSync(path.join(playlistDir, segment))).toBe(true);
        });
    });
  });
});
