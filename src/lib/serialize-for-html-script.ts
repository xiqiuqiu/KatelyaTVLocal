/**
 * Serialize a value for embedding inside a <script> tag via dangerouslySetInnerHTML.
 * JSON.stringify alone does not HTML-escape, so `</script>` in a string can break out.
 */
export function serializeForHtmlScript(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}
