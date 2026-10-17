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

    // Check preceding text before the fence for Markdown headers:
    // e.g. ### `src/App.tsx` or File: `src/App.tsx`
    if (!filePath) {
      const precedingText = text.slice(Math.max(0, match.index - 200), match.index);
      const headerMatch = precedingText.match(
        /(?:###|##|#|File:)\s*[`*]?([a-zA-Z0-9_\-\.\/]+\.[a-zA-Z0-9]+)[`*]?/i
      );
      if (headerMatch && headerMatch[1]) {
        filePath = headerMatch[1].trim();
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
