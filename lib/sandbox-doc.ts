export function wrapSandboxed(bodyHtml: string): string {
  return (
    '<!doctype html><html><head><meta http-equiv="Content-Security-Policy" ' +
    "content=\"default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:\">" +
    "</head><body>" + bodyHtml + "</body></html>"
  );
}
