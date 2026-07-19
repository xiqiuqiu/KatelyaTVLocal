import { serializeForHtmlScript } from './serialize-for-html-script';

describe('serializeForHtmlScript', () => {
  it('does not emit a literal </script> substring', () => {
    const payload = {
      CURRENT_USER: { username: '</script><script>alert(1)</script>' },
    };
    const serialized = serializeForHtmlScript(payload);
    expect(serialized).not.toContain('</script>');
    expect(JSON.parse(serialized)).toEqual(payload);
  });

  it('escapes <, >, &, and line separators', () => {
    const payload = {
      a: '<',
      b: '>',
      c: '&',
      d: '\u2028',
      e: '\u2029',
    };
    const serialized = serializeForHtmlScript(payload);
    expect(serialized).toContain('\\u003c');
    expect(serialized).toContain('\\u003e');
    expect(serialized).toContain('\\u0026');
    expect(serialized).toContain('\\u2028');
    expect(serialized).toContain('\\u2029');
    expect(JSON.parse(serialized)).toEqual(payload);
  });
});
