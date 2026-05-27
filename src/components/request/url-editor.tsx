import {
  autocompletion,
  type CompletionContext,
  type CompletionResult,
} from "@codemirror/autocomplete";
import { EditorState, Prec } from "@codemirror/state";
import {
  placeholder as cmPlaceholder,
  Decoration,
  type DecorationSet,
  EditorView,
  keymap,
  MatchDecorator,
  ViewPlugin,
  type ViewUpdate,
} from "@codemirror/view";
import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef } from "react";
import { cn } from "@/lib/utils";

/** Imperative handle so the url-bar's Ctrl/Cmd+L can focus + select the URL. */
export interface UrlEditorHandle {
  focus: () => void;
  /** Focus and select the whole value (browser address-bar style). */
  select: () => void;
}

interface UrlEditorProps {
  value: string;
  onChange: (next: string) => void;
  /** Fired when the user presses Enter (no Shift). Drives send / connect. */
  onEnter: () => void;
  /** Native paste passthrough — the url-bar uses this for cURL detection. */
  onPaste?: (e: React.ClipboardEvent<HTMLDivElement>) => void;
  placeholder?: string;
  /** Active variable names offered as `{{name}}` autocomplete entries. */
  varNames?: readonly string[];
  className?: string;
  "aria-label"?: string;
}

/** Colors `{{var}}` tokens with the theme primary — subtle, no overlay hack. */
const tokenMark = Decoration.mark({ class: "cm-var-token" });
const tokenMatcher = new MatchDecorator({
  regexp: /\{\{[^}]*\}\}/g,
  decoration: tokenMark,
});

const tokenHighlighter = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = tokenMatcher.createDeco(view);
    }
    update(u: ViewUpdate) {
      this.decorations = tokenMatcher.updateDeco(u, this.decorations);
    }
  },
  { decorations: (v) => v.decorations },
);

/**
 * Single-line CodeMirror theme tuned to look exactly like `ui/input.tsx`:
 * h-9 box (set on the wrapper), px-3 / font-mono / md:text-sm content, no
 * gutters, no wrap. Selection uses the app's primary tint — native CM
 * selection means NO doubled/overlapping text (the old HighlightInput bug).
 */
const urlTheme = EditorView.theme({
  // NOTE: do NOT make `.cm-editor`/`.cm-scroller` flex — it fights CodeMirror's
  // own layout and causes vertical drift + height growth while editing. Instead
  // we fix the line box to the wrapper's inner height (h-9 = 36px minus the 1px
  // top/bottom border ≈ 34px) so the single line is centered and never grows.
  "&": {
    fontFamily:
      'var(--font-mono), "JetBrains Mono", ui-monospace, "SFMono-Regular", Menlo, monospace',
    fontSize: "14px",
    color: "var(--color-foreground)",
    backgroundColor: "transparent",
    width: "100%",
    height: "100%",
  },
  "&.cm-focused": {
    outline: "none",
  },
  // Match md:text-sm at the >=768px breakpoint, mirroring Input.
  "@media (min-width: 768px)": {
    "&": { fontSize: "13px" },
  },
  ".cm-scroller": {
    fontFamily: "inherit",
    // Horizontal scroll for long URLs; never grow/scroll vertically.
    overflowX: "auto",
    overflowY: "hidden",
    lineHeight: "34px",
  },
  ".cm-content": {
    padding: "0",
    paddingLeft: "12px",
    // pr handled by the wrapper's pr-8 so the Clear (×) button never overlaps.
    caretColor: "var(--color-foreground)",
    minHeight: "0",
  },
  ".cm-line": {
    padding: "0",
    lineHeight: "34px",
  },
  ".cm-placeholder": {
    color: "var(--color-muted-foreground)",
  },
  ".cm-cursor": {
    borderLeftColor: "var(--color-foreground)",
  },
  ".cm-selectionBackground, &.cm-focused .cm-selectionBackground, ::selection": {
    backgroundColor: "color-mix(in oklch, var(--color-primary) 30%, transparent) !important",
  },
  ".cm-var-token": {
    color: "var(--color-primary)",
    backgroundColor: "color-mix(in oklch, var(--color-primary) 14%, transparent)",
    borderRadius: "3px",
  },
  ".cm-tooltip": {
    backgroundColor: "var(--color-popover)",
    borderColor: "var(--color-border)",
    color: "var(--color-popover-foreground)",
    borderRadius: "var(--radius-md, 6px)",
  },
  ".cm-tooltip.cm-tooltip-autocomplete > ul": {
    fontFamily: "inherit",
    fontSize: "13px",
    maxHeight: "16rem",
  },
  ".cm-tooltip-autocomplete ul li[aria-selected]": {
    backgroundColor: "color-mix(in oklch, var(--color-primary) 18%, transparent)",
    color: "var(--color-foreground)",
  },
  ".cm-completionIcon": {
    display: "none",
  },
});

/** Block every newline so the editor stays strictly single-line. */
const singleLine = EditorState.transactionFilter.of((tr) => {
  if (!tr.docChanged) return tr;
  let hasNewline = false;
  tr.changes.iterChanges((_fa, _ta, _fb, _tb, inserted) => {
    if (inserted.lines > 1) hasNewline = true;
  });
  if (!hasNewline) return tr;
  // Strip newlines from any inserted text (e.g. multi-line paste).
  const sanitized: { from: number; to: number; insert: string }[] = [];
  tr.changes.iterChanges((fromA, toA, _fb, _tb, inserted) => {
    sanitized.push({ from: fromA, to: toA, insert: inserted.toString().replace(/[\n\r]/g, "") });
  });
  return [{ changes: sanitized, selection: tr.selection, scrollIntoView: true }];
});

/**
 * Single-line CodeMirror URL editor. Replaces the old transparent-input-over-
 * backdrop `HighlightInput` (which doubled text on selection). Provides:
 *  - native selection (no overlap bug),
 *  - `{{var}}` token coloring (MatchDecorator),
 *  - `{{`-triggered autocomplete of the active variable names,
 *  - Enter → onEnter (send/connect), newlines blocked, no wrap,
 *  - imperative focus()/select() for Ctrl/Cmd+L.
 */
export const UrlEditor = forwardRef<UrlEditorHandle, UrlEditorProps>(function UrlEditor(
  { value, onChange, onEnter, onPaste, placeholder, varNames = [], className, ...rest },
  ref,
) {
  const ariaLabel = rest["aria-label"];
  const hostRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);

  // Keep the latest callbacks / data in refs so the editor's extensions
  // (built once) always see current values without rebuilding the view.
  const onChangeRef = useRef(onChange);
  const onEnterRef = useRef(onEnter);
  const varNamesRef = useRef<readonly string[]>(varNames);
  onChangeRef.current = onChange;
  onEnterRef.current = onEnter;
  varNamesRef.current = varNames;

  useImperativeHandle(
    ref,
    () => ({
      focus: () => viewRef.current?.focus(),
      select: () => {
        const view = viewRef.current;
        if (!view) return;
        view.focus();
        view.dispatch({ selection: { anchor: 0, head: view.state.doc.length } });
      },
    }),
    [],
  );

  // Autocomplete source: when the cursor sits right after `{{` (optionally
  // mid-name), offer the active variable names. Applying inserts `name}}`
  // (closing braces only if not already present).
  const completionSource = useMemo(
    () =>
      (context: CompletionContext): CompletionResult | null => {
        const before = context.matchBefore(/\{\{\s*[\w-]*$/);
        if (!before) return null;
        const names = varNamesRef.current;
        if (names.length === 0) return null;
        // Are the closing braces already there right after the cursor?
        const after = context.state.sliceDoc(context.pos, context.pos + 2);
        const needsClose = after !== "}}";
        // Start replacing from just after the `{{` so the typed prefix filters.
        const openIdx = before.text.search(/\{\{/);
        const from = before.from + openIdx + 2;
        return {
          from,
          options: names.map((name) => ({
            label: name,
            type: "variable",
            apply: needsClose ? `${name}}}` : name,
          })),
          validFor: /^[\w-]*$/,
        };
      },
    [],
  );

  // Build the editor once on mount. Value is synced via effects below.
  // biome-ignore lint/correctness/useExhaustiveDependencies: editor is created once; live data flows through refs.
  useEffect(() => {
    if (!hostRef.current) return;
    const state = EditorState.create({
      doc: value,
      extensions: [
        singleLine,
        tokenHighlighter,
        urlTheme,
        cmPlaceholder(placeholder ?? ""),
        autocompletion({
          override: [completionSource],
          icons: false,
          activateOnTyping: true,
        }),
        // Enter sends; Shift+Enter is ignored (still no newline). High prec so
        // it beats any default Enter handling.
        Prec.highest(
          keymap.of([
            {
              key: "Enter",
              run: () => {
                onEnterRef.current();
                return true;
              },
            },
            { key: "Shift-Enter", run: () => true },
          ]),
        ),
        EditorView.contentAttributes.of({
          // Accessible role/name so the url-bar test (and screen readers) can
          // find the field. CM's .cm-content is role=textbox by default.
          "aria-label": ariaLabel ?? "Request URL",
        }),
        EditorView.updateListener.of((u) => {
          if (u.docChanged) {
            onChangeRef.current(u.state.doc.toString());
          }
        }),
      ],
    });
    const view = new EditorView({ state, parent: hostRef.current });
    viewRef.current = view;
    return () => {
      view.destroy();
      viewRef.current = null;
    };
  }, []);

  // Sync external value changes (Clear, cURL parse, programmatic setUrl) into
  // the editor without clobbering the cursor when the value already matches.
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const current = view.state.doc.toString();
    if (current !== value) {
      view.dispatch({
        changes: { from: 0, to: current.length, insert: value },
      });
    }
  }, [value]);

  return (
    <div
      ref={hostRef}
      onPaste={onPaste}
      className={cn(
        // Box model parity with ui/input.tsx: h-9, rounded, border, shadow.
        "flex h-9 w-full min-w-0 items-center overflow-hidden rounded-md border border-input bg-transparent shadow-xs transition-[color,box-shadow] dark:bg-input/30",
        "focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/50",
        className,
      )}
    />
  );
});
