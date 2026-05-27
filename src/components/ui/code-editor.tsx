import { html } from "@codemirror/lang-html";
import { javascript } from "@codemirror/lang-javascript";
import { json } from "@codemirror/lang-json";
import { xml } from "@codemirror/lang-xml";
import { EditorView } from "@codemirror/view";
import CodeMirror, { type Extension } from "@uiw/react-codemirror";
import { useMemo } from "react";

import { cn } from "@/lib/utils";

/** Languages we ship out of the box. Add more by extending the switch. */
export type CodeLanguage = "json" | "xml" | "html" | "javascript" | "graphql" | "text";

interface CodeEditorProps {
  value: string;
  onChange: (next: string) => void;
  language?: CodeLanguage;
  placeholder?: string;
  /** When true, render a faded read-only state with disabled editing */
  readOnly?: boolean;
  /** Min editor height (default: 200px) */
  minHeight?: string;
  /** Class on the outer wrapper */
  className?: string;
}

/**
 * Lancer-themed CodeMirror 6 wrapper. Uses the app's design tokens
 * (foreground/background/primary) so the editor sits cleanly inside the
 * editor panel — no jarring light blue selection or default fonts.
 *
 * One CodeMirror instance per language. The wrapper is the only place
 * the rest of the app should touch CM — keep all CM imports here.
 */
export function CodeEditor({
  value,
  onChange,
  language = "json",
  placeholder,
  readOnly,
  minHeight = "200px",
  className,
}: CodeEditorProps) {
  const extensions = useMemo<Extension[]>(() => {
    const exts: Extension[] = [
      // Use the app's mono font + size + comfortable line-height
      EditorView.theme({
        "&": {
          fontFamily:
            'var(--font-mono), "JetBrains Mono", ui-monospace, "SFMono-Regular", Menlo, monospace',
          fontSize: "12px",
          backgroundColor: "transparent",
          color: "var(--color-foreground)",
        },
        ".cm-content": {
          padding: "8px 12px",
          caretColor: "var(--color-primary)",
        },
        ".cm-gutters": {
          backgroundColor: "transparent",
          border: "none",
          color: "color-mix(in oklch, var(--color-muted-foreground) 70%, transparent)",
        },
        ".cm-activeLine": {
          backgroundColor: "color-mix(in oklch, var(--color-primary) 4%, transparent)",
        },
        ".cm-activeLineGutter": {
          backgroundColor: "transparent",
          color: "var(--color-foreground)",
        },
        ".cm-selectionBackground, ::selection": {
          backgroundColor: "color-mix(in oklch, var(--color-primary) 30%, transparent) !important",
        },
        "&.cm-focused .cm-selectionBackground": {
          backgroundColor: "color-mix(in oklch, var(--color-primary) 35%, transparent) !important",
        },
        ".cm-cursor": {
          borderLeftColor: "var(--color-primary)",
          borderLeftWidth: "1.5px",
        },
        ".cm-tooltip": {
          backgroundColor: "var(--color-popover)",
          borderColor: "var(--color-border)",
          color: "var(--color-popover-foreground)",
        },
        // Bracket matching colours
        "&.cm-focused .cm-matchingBracket": {
          backgroundColor: "color-mix(in oklch, var(--color-primary) 25%, transparent)",
          outline: "1px solid color-mix(in oklch, var(--color-primary) 40%, transparent)",
          borderRadius: "2px",
        },
        ".cm-nonmatchingBracket": {
          color: "var(--color-destructive)",
          fontWeight: "600",
        },
      }),
      // Match Lancer's dark/light token-aware syntax colours
      EditorView.baseTheme({}),
      EditorView.lineWrapping,
    ];

    // Language-specific extensions
    switch (language) {
      case "json":
        exts.push(json());
        break;
      case "xml":
        exts.push(xml());
        break;
      case "html":
        exts.push(html());
        break;
      case "javascript":
        exts.push(javascript());
        break;
      case "graphql":
        // GraphQL — no first-party CM lang yet; JS fallback gives ok bracket
        // matching. We can add @codemirror/lang-graphql later for proper syntax.
        exts.push(javascript());
        break;
      case "text":
        // No language extension — plain text mode
        break;
    }

    return exts;
  }, [language]);

  return (
    <div
      className={cn(
        "overflow-hidden rounded-md border border-border bg-background transition-colors focus-within:border-ring focus-within:shadow-[var(--shadow-glow)]",
        className,
      )}
    >
      <CodeMirror
        value={value}
        onChange={onChange}
        readOnly={readOnly}
        placeholder={placeholder}
        extensions={extensions}
        basicSetup={{
          lineNumbers: true,
          foldGutter: true,
          bracketMatching: true,
          closeBrackets: true,
          autocompletion: false,
          highlightActiveLine: true,
          highlightActiveLineGutter: true,
          highlightSelectionMatches: false,
          syntaxHighlighting: true,
          indentOnInput: true,
          // CodeMirror 6 ships multi-cursor support; enable it so Ctrl/Alt-
          // click adds a cursor and Ctrl-D extends selection — VS Code parity.
          allowMultipleSelections: true,
          drawSelection: true,
        }}
        height="100%"
        minHeight={minHeight}
        style={{
          height: "100%",
          fontSize: "12px",
        }}
        theme="none"
      />
    </div>
  );
}
