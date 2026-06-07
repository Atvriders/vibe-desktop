/** Strip a wrapping markdown code fence (```html … ```) the model sometimes
 *  emits around its HTML, so it doesn't render as literal text or pollute the
 *  conversation. Leaves unfenced HTML untouched. */
export function stripFences(s: string): string {
  let t = s.trim();
  const open = t.match(/^```[a-zA-Z]*[ \t]*\r?\n?/);
  if (open) {
    t = t.slice(open[0].length).replace(/\r?\n?```[ \t]*$/, "");
  }
  return t.trim();
}
