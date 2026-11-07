import { describe, expect, test } from "bun:test";
import { assertFetchable, extractReadable, isBlockedHost } from "./services/enrich";

describe("ssrf guard", () => {
  test("blocks private and metadata hosts", () => {
    for (const host of [
      "localhost",
      "127.0.0.1",
      "10.0.0.5",
      "172.16.4.2",
      "192.168.1.1",
      "169.254.169.254",
      "metadata.google.internal",
      "printer.local",
      "::1",
      "fd00::1",
    ]) {
      expect(isBlockedHost(host)).toBe(true);
    }
  });

  test("allows public hosts", () => {
    for (const host of ["example.com", "developers.cloudflare.com", "8.8.8.8"]) {
      expect(isBlockedHost(host)).toBe(false);
    }
  });

  test("rejects non-http and credentials", () => {
    expect(() => assertFetchable("file:///etc/passwd")).toThrow();
    expect(() => assertFetchable("http://user:pass@example.com")).toThrow();
    expect(() => assertFetchable("http://127.0.0.1:8787")).toThrow();
    expect(assertFetchable("https://example.com/a").hostname).toBe("example.com");
  });
});

describe("readability", () => {
  test("extracts title, description and text without scripts", () => {
    const page = extractReadable(`
      <html><head><title>Edge &amp; recall</title>
      <meta name="description" content="A short description"></head>
      <body><script>alert(1)</script><style>.x{}</style>
      <h1>Heading</h1><p>First paragraph.</p><p>Second &lt;paragraph&gt;.</p></body></html>
    `);
    expect(page.title).toBe("Edge & recall");
    expect(page.description).toBe("A short description");
    expect(page.text).toContain("First paragraph.");
    expect(page.text).toContain("Second <paragraph>.");
    expect(page.text).not.toContain("alert(1)");
    expect(page.text).not.toContain(".x{}");
  });

  test("caps text size", () => {
    const page = extractReadable(`<body>${"a".repeat(200_000)}</body>`);
    expect(page.text.length).toBeLessThanOrEqual(100_000);
  });
});
