import { readFileSync } from 'fs';
import { join } from 'path';

const { Linter } = jest.requireActual('eslint');

const eslintConfig = jest.requireActual('../../.eslintrc');

const linter = new Linter();
linter.defineParser(
  'typescript',
  jest.requireActual('@typescript-eslint/parser')
);
const config = {
  parser: 'typescript',
  parserOptions: { ecmaVersion: 2021, sourceType: 'module' },
  rules: eslintConfig.overrides[0].rules,
};
const page = readFileSync(join(__dirname, '../app/play/page.tsx'), 'utf8');
const start = page.indexOf('m3u8: function');
const end = page.indexOf('if (video.hls)', start);
const binding = page.slice(start, end);
const lint = (code: string) =>
  linter.verify(code, config, {
    filename: 'page.tsx',
    allowInlineConfig: false,
  });
const fixture = (body: string) =>
  `const customType = { ${body} const hls = new Hls(); hls.loadSource(url); } };`;

it('accepts the production HLS binding and the actual play page', () => {
  expect(start).toBeGreaterThan(0);
  expect(end).toBeGreaterThan(start);
  expect(lint(fixture(binding))).toEqual([]);
  expect(lint(page)).toEqual([]);
});

it.each<[string, (code: string) => string]>([
  [
    'missing reconnect binding',
    (code) => code.replace('art.option.url = url;', ''),
  ],
  [
    'wrong reconnect URL',
    (code) =>
      code.replace('art.option.url = url;', 'art.option.url = video.src;'),
  ],
  [
    'missing URL guard',
    (code) => code.replace(' || url !== videoUrlRef.current', ''),
  ],
  [
    'reversed URL guard',
    (code) =>
      code.replace(
        'url !== videoUrlRef.current',
        'url === videoUrlRef.current'
      ),
  ],
  ['guard does not return', (code) => code.replace('return;', 'void 0;')],
  [
    'guard returns a side effect',
    (code) => code.replace('return;', 'return hls.loadSource(url);'),
  ],
  [
    'video.src as identity',
    (code) => code.replace('videoUrlRef.current', 'video.src'),
  ],
  [
    'side effect before guard',
    (code) => code.replace('{\n', '{\n video.hls.destroy();\n'),
  ],
  [
    'binding after loader creation',
    (code) =>
      code.replace('art.option.url = url;', 'new Hls(); art.option.url = url;'),
  ],
])('rejects %s', (_name, mutate) => {
  const changed = mutate(binding);
  expect(changed).not.toBe(binding);
  expect(lint(fixture(changed))).toEqual([
    expect.objectContaining({ ruleId: 'no-restricted-syntax', severity: 2 }),
  ]);
});
