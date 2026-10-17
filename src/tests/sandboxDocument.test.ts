import { describe, it, expect } from 'vitest';
import { buildSandboxDocument, embedSandboxSource } from '../utils/sandboxDocument';

describe('Sandbox document builder', () => {
  it('1. Keeps a full HTML document intact and injects the console interceptor', () => {
    const html = `<!DOCTYPE html>
<html>
<head><title>game</title></head>
<body><h1>hello</h1><script>console.log("hi");</script></body>
</html>`;

    const out = buildSandboxDocument(html);

    expect(out).toContain('<title>game</title>');
    expect(out).toContain('<h1>hello</h1>');
    expect(out).toContain('PREVIEW_CONSOLE_LOG');
    expect(out).toContain('window.onerror');
    // The interceptor must run before the document's own scripts.
    expect(out.indexOf('PREVIEW_CONSOLE_LOG')).toBeLessThan(out.indexOf('console.log("hi")'));
    // A complete document is trusted as-is: no Babel/import-map rewriting.
    expect(out).not.toContain('importmap');
    expect(out).not.toContain('sandbox.tsx');
  });

  it('2. Renders an HTML fragment and re-executes its inline scripts', () => {
    const fragment = `<div id="box">hi</div>\n<script>console.log("fragment ran");</script>`;

    const out = buildSandboxDocument(fragment);

    expect(out).toContain('DOMParser');
    expect(out).toContain("document.createElement('script')");
    expect(out).toContain('fragment ran');
    expect(out).toContain('PREVIEW_CONSOLE_LOG');
  });

  it('3. A pasted </script> can never break out of the hosting script', () => {
    const nasty = 'console.log("</script><img src=x onerror=alert(1)>");';

    const out = buildSandboxDocument(nasty);

    // The raw closing tag must be escaped, and no unescaped copy may reach the document.
    expect(out).toContain('\\u003C/script');
    expect(out).not.toContain('</script><img');
    expect(out.match(/<\/script>/g)?.length).toBe(out.match(/<script/g)?.length);
  });

  it('4. Compiles TSX/JSX through Babel and runs it as a module', () => {
    const tsx = `import React from 'react';\ntype P = { x: number };\nexport default function App({ x }: P) { return <h1>{x}</h1>; }`;

    const out = buildSandboxDocument(tsx);

    expect(out).toContain('type="importmap"');
    expect(out).toContain('https://esm.sh/react@19.1.0');
    expect(out).toContain('https://esm.sh/react@19.1.0/'); // jsx-runtime for automatic preset
    expect(out).toContain('babel.min.js');
    expect(out).toContain("'typescript'");
    expect(out).toContain("['react', { runtime: 'automatic' }]");
    expect(out).toContain('sandbox.tsx');
    expect(out).toContain('await import(moduleUrl)');
    // `export default` becomes a global so the sandbox can auto-mount it.
    expect(out).toContain('window.App = function App');
    expect(out).toContain('getElementById(\'app-root\')');
  });

  it('5. Treats plain JavaScript as a module without touching its text', () => {
    const js = 'console.log("plain js");';
    const out = buildSandboxDocument(js);

    expect(out).toContain('console.log(\\"plain js\\")');
    expect(out).toContain('type="module"');
  });

  it('6. Escapes source strings so they round-trip exactly', () => {
    const tricky = 'line1\nline2 "</script>" `backtick` \\backslash\\ \u2028 separator';

    const literal = embedSandboxSource(tricky);
    const roundTripped = new Function(`return ${literal};`)() as string;

    expect(roundTripped).toBe(tricky);
    expect(literal).not.toContain('</script');
    expect(literal).not.toContain('\u2028');
  });
});
