/**
 * Builds the document that runs inside the live preview iframe.
 *
 * Pasted code arrives in four shapes, and each needs different handling:
 *  1. A full HTML document  -> kept as-is, with the console/error interceptor injected.
 *  2. An HTML fragment      -> markup rendered, then inline scripts re-created so they execute.
 *  3. TypeScript / JSX      -> compiled by Babel (preset-typescript + react) and run as a module,
 *                              so TSX copied out of a Vite/React project actually runs.
 *  4. Plain JavaScript      -> same module path; imports resolve through the import map.
 *
 * The pasted source is always embedded as an escaped JS string literal: it can therefore never
 * terminate the hosting <script> early, and it stays byte-identical for every code path.
 */

/**
 * Reports iframe console output and runtime errors back to the parent window.
 *
 * Exported because the server builds preview documents too (a whole project folder, not just one
 * pasted file), and both sides must speak the same `PREVIEW_CONSOLE_LOG` protocol for the console
 * panel to show anything.
 */
export const ERROR_INTERCEPTOR = `
      <script>
        (function() {
          function sendLog(type, msg) {
            window.parent.postMessage({
              type: 'PREVIEW_CONSOLE_LOG',
              logType: type,
              text: typeof msg === 'object' ? JSON.stringify(msg) : String(msg),
              time: new Date().toLocaleTimeString()
            }, '*');
          }

          var oldLog = console.log;
          console.log = function() {
            var args = Array.prototype.slice.call(arguments);
            sendLog('log', args.join(' '));
            oldLog.apply(console, args);
          };

          var oldError = console.error;
          console.error = function() {
            var args = Array.prototype.slice.call(arguments);
            sendLog('error', args.join(' '));
            oldError.apply(console, args);
          };

          window.onerror = function(msg, url, line, col, error) {
            var errStr = 'Error: ' + msg + ' (Line ' + line + ')';
            sendLog('error', errStr);
            return false;
          };
        })();
      </script>
    `;

/** Escapes a source string so it is safe inside a <script> element. */
export function embedSandboxSource(source: string): string {
  return JSON.stringify(source)
    .replace(/</g, '\\u003C')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

const BASE_STYLE = `
    body { margin: 0; padding: 16px; background-color: #0f172a; color: #f8fafc; font-family: ui-sans-serif, system-ui, sans-serif; }
  `;

export function buildSandboxDocument(rawCode: string): string {
  // 1. Full HTML document: inject the interceptor right after <head> (or prepend it).
  if (rawCode.toLowerCase().includes('<html') || rawCode.toLowerCase().includes('<body')) {
    if (rawCode.includes('<head>')) {
      return rawCode.replace('<head>', '<head>' + ERROR_INTERCEPTOR);
    }
    return ERROR_INTERCEPTOR + rawCode;
  }

  // 2. HTML fragment (markup plus inline scripts, e.g. "<div>…</div><script>…</script>").
  const isHtmlFragment = /^\s*</.test(rawCode) || /<script[\s>]/i.test(rawCode);
  if (isHtmlFragment) {
    return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <script src="https://cdn.tailwindcss.com"></script>
  <script src="https://cdn.jsdelivr.net/npm/phaser@3.80.0/dist/phaser.min.js"></script>
  <style>${BASE_STYLE}</style>
  ${ERROR_INTERCEPTOR}
</head>
<body>
  <div id="app-root"></div>
  <div id="root"></div>
  <script>
    (function () {
      var raw = ${embedSandboxSource(rawCode)};
      var holder = document.createElement('div');
      holder.innerHTML = raw;
      var parsed = new DOMParser().parseFromString(raw, 'text/html');
      var scripts = Array.prototype.slice.call(parsed.querySelectorAll('script'));
      Array.prototype.slice.call(holder.querySelectorAll('script')).forEach(function (stale) {
        stale.parentNode.removeChild(stale);
      });
      document.body.appendChild(holder);
      scripts.forEach(function (old) {
        var fresh = document.createElement('script');
        if (old.src) { fresh.src = old.src; }
        else { fresh.textContent = old.textContent; }
        document.body.appendChild(fresh);
      });
    })();
  </script>
</body>
</html>`;
  }

  // 3. + 4. Script / module mode.
  const processedCode = rawCode.replace(/export\s+default\s+/g, 'window.App = ');

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <script type="importmap">
    {
      "imports": {
        "react": "https://esm.sh/react@19.1.0",
        "react/": "https://esm.sh/react@19.1.0/",
        "react-dom": "https://esm.sh/react-dom@19.1.0",
        "react-dom/client": "https://esm.sh/react-dom@19.1.0/client",
        "react-router-dom": "https://esm.sh/react-router-dom@7.1.1?external=react,react-dom",
        "lucide-react": "https://esm.sh/lucide-react@0.344.0?external=react",
        "phaser": "https://esm.sh/phaser@3.80.0"
      }
    }
  </script>
  <script src="https://cdn.tailwindcss.com"></script>
  <script src="https://cdn.jsdelivr.net/npm/phaser@3.80.0/dist/phaser.min.js"></script>
  <script src="https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js"></script>
  <script src="https://unpkg.com/@babel/standalone/babel.min.js"></script>
  <style>${BASE_STYLE}</style>
  ${ERROR_INTERCEPTOR}
</head>
<body>
  <div id="app-root"></div>
  <div id="root"></div>
  <script type="module">
    try {
      const raw = ${embedSandboxSource(processedCode)};
      if (!window.Babel) throw new Error('Babel compiler did not load — check your internet connection.');
      const compiled = window.Babel.transform(raw, {
        filename: 'sandbox.tsx',
        // The .tsx filename tells preset-typescript to expect JSX + type annotations, so TSX
        // copied straight out of a Vite project compiles without extra options.
        presets: [
          ['react', { runtime: 'automatic' }],
          'typescript'
        ]
      }).code;
      const moduleUrl = URL.createObjectURL(new Blob([compiled], { type: 'text/javascript' }));
      await import(moduleUrl);

      // Auto-mount a default-exported React component when the code does not mount itself.
      const root = document.getElementById('app-root');
      if (typeof window.App !== 'undefined' && root && !root.hasChildNodes()) {
        const [ReactModule, ReactDOMModule] = await Promise.all([import('react'), import('react-dom/client')]);
        const React = ReactModule.default || ReactModule;
        const createRoot = ReactDOMModule.createRoot || ReactDOMModule.default?.createRoot;
        if (createRoot) createRoot(root).render(React.createElement(window.App));
      }
    } catch (err) {
      console.error('Sandbox error: ' + ((err && err.message) ? err.message : String(err)));
    }
  </script>
</body>
</html>`;
}
