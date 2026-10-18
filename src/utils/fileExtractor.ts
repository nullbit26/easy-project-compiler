export interface ExtractedCodeFile {
  path: string;
  content: string;
  language?: string;
}

/**
 * Extracts individual source code files from AI agent output,
 * parsing common markdown code block notations and file path headers.
 */
export function extractFilesFromAgentOutput(
  text: string,
  defaultPath?: string
): ExtractedCodeFile[] {
  if (!text || typeof text !== 'string') return [];

  const files: ExtractedCodeFile[] = [];
  const seenPaths = new Set<string>();

  // Regex pattern 1: Code fences with language and optional filename in fence line
  // e.g. ```tsx src/components/Header.tsx
  // or ```typescript file="src/index.ts"
  const fenceWithHeaderRegex = /```([a-zA-Z0-9_\-+#]+)?(?:\s+(?:file=|filepath=|path=)?["']?([a-zA-Z0-9_\-\.\/]+)["']?)?\s*\n([\s\S]*?)```/g;

  let match: RegExpExecArray | null;
  while ((match = fenceWithHeaderRegex.exec(text)) !== null) {
    const lang = match[1] || '';
    let filePath = match[2] || '';
    const body = match[3] || '';

    // If filePath not in fence line, check first 5 lines of body for comments:
    // // File: src/App.tsx or /* File: src/App.tsx */ or # File: src/main.py
    if (!filePath) {
      const headerLines = body.slice(0, 400).split('\n');
      for (const line of headerLines) {
        const commentMatch = line.match(
          /(?:\/\/|\/\*|#|<!--|--)\s*(?:file|filepath|filename|path)?:\s*([a-zA-Z0-9_\-\.\/]+\.[a-zA-Z0-9]+)/i
        );
        if (commentMatch && commentMatch[1]) {
          filePath = commentMatch[1].trim();
          break;
        }
      }
    }

    /*
     * Check the lines just above the fence for a Markdown header — `### src/App.tsx`,
     * `**package.json**`, `File: tsconfig.json`.
     *
     * The closest line wins, and only a line that is *nothing but* a name counts. The old version
     * searched the last 200 characters for the first "###" it could find, so an answer with several
     * files in it named the earlier file again: `### src/main.ts … ### package.json` came back as
     * one file called `src/main.ts`, and the dedupe below then dropped it entirely. That is how the
     * files the reviewer keeps asking for — package.json, tsconfig.json, jest.config.js — could
     * never reach the folder: the beginner pressed "write the code" and got a single source file.
     */
    if (!filePath) {
      const linesAbove = text.slice(0, match.index).split('\n').slice(-3);
      for (let i = linesAbove.length - 1; i >= 0; i -= 1) {
        const line = linesAbove[i].trim();
        if (!line || line.length > 160) continue;
        const headerMatch = line.match(
          /^(?:#{1,6}\s+|\/\/\s*|#\s*|File:\s*)?[`'"*]*((?:[A-Za-z0-9_.\-]+\/)*[A-Za-z0-9_.\-]+\.[A-Za-z0-9]+)[`'"*.,:;\s]*$/i
        );
        if (headerMatch && headerMatch[1]) {
          filePath = headerMatch[1].trim();
          break;
        }
      }
    }

    if (filePath && filePath.includes('.') && body.trim()) {
      if (!seenPaths.has(filePath)) {
        seenPaths.add(filePath);
        files.push({
          path: filePath,
          content: body.trim(),
          language: lang
        });
      }
    }
  }

  // Fallback: If no files with paths were found, but there is a clear code block and defaultPath is provided
  if (files.length === 0 && defaultPath) {
    const genericCodeFence = /```(?:[a-zA-Z0-9_\-+#]+)?\n([\s\S]*?)```/;
    const genericMatch = genericCodeFence.exec(text);
    if (genericMatch && genericMatch[1] && genericMatch[1].trim().length > 30) {
      files.push({
        path: defaultPath,
        content: genericMatch[1].trim()
      });
    }
  }

  return files;
}
