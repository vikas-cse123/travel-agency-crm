import { useEffect, useRef } from 'react';
import { Bold, Italic, Underline, Link as LinkIcon, List, ListOrdered } from 'lucide-react';
import {
  decodeHtmlEntities,
  insertNormalizedPaste,
  ensureBlankParagraphs,
  wrapOrphanListItems,
} from '@/utils/richTextPaste';

interface RichTextEditorProps {
  value: string;
  onChange: (html: string) => void;
  ariaLabel: string;
  placeholder?: string;
}

/**
 * A dependency-free rich-text editor matching the reference quotation editors
 * (bold / italic / underline / lists / link). It stores HTML and stays
 * uncontrolled internally — the DOM is only rewritten when `value` changes from
 * the outside (e.g. loading a saved draft), never while the user is typing, so
 * the caret never jumps.
 */
function plainTextToHtml(value: string): string {
  const decoded = decodeHtmlEntities(value);
  return decoded
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\r\n|\r|\n/g, '<br>');
}

function richTextToDisplayHtml(value: string): string {
  const decoded = decodeHtmlEntities(value ?? '');
  return decoded.includes('<') ? decoded : plainTextToHtml(decoded);
}

export function RichTextEditor({ value, onChange, ariaLabel, placeholder }: RichTextEditorProps) {
  const ref = useRef<HTMLDivElement>(null);
  // HTML last emitted from this editor instance. The parent echoes it back
  // via `value`; that echo must never rewrite the DOM. Rewriting would run
  // entity/whitespace normalization (e.g. `&nbsp;` vs a raw space) whose
  // output differs textually from `innerHTML`, resetting the caret on every
  // keystroke — notably after SPACE — and corrupting typed text.
  const lastEmitted = useRef<string | null>(null);

  useEffect(() => {
    const next = value ?? '';
    // Own echo of what the user just typed: leave the DOM (and caret) alone.
    if (next === lastEmitted.current) return;
    const el = ref.current;
    if (!el) return;
    // External change (initial load, saved content, section switch): display it.
    // Legacy blank paragraphs (`<p></p>`, `<p><span></span></p>`, `<p>&nbsp;</p>`)
    // become a real blank line so the editor matches the read-only detail view;
    // leading/trailing clipboard junk is trimmed. Interior blanks are kept.
    const html = ensureBlankParagraphs(wrapOrphanListItems(richTextToDisplayHtml(next)), {
      trimEdges: true,
    });
    if (el.innerHTML !== html) el.innerHTML = html;
    lastEmitted.current = next;
  }, [value]);

  useEffect(() => {
    // Keep Enter's block tag consistent with the `<p>` structure the paste
    // normalizer stores, instead of the browser-default `<div>` siblings, so
    // typed and pasted content share one block model. Not a second editor —
    // just the standard paragraph separator.
    if (typeof document.execCommand !== 'function') return;
    try {
      document.execCommand('defaultParagraphSeparator', false, 'p');
    } catch {
      /* unsupported browser: Enter keeps the browser default separator */
    }
  }, []);

  const emit = () => {
    if (!ref.current) return;
    // Serialize interior blank paragraphs as `<p><br></p>` (never as a bare
    // `<p></p>` that a read-only render would collapse). No edge trimming here:
    // the trailing blank the user is currently typing on must be kept.
    const html = ensureBlankParagraphs(ref.current.innerHTML);
    lastEmitted.current = html;
    onChange(html);
  };
  const exec = (command: string, arg?: string) => {
    ref.current?.focus();
    document.execCommand(command, false, arg);
    emit();
  };
  const addLink = () => {
    const url = window.prompt('Link URL');
    if (url) exec('createLink', url);
  };

  const btn = 'rounded p-1.5 text-slate-600 hover:bg-slate-100';
  return (
    <div className="overflow-hidden rounded-lg border border-slate-300 focus-within:border-brand-500">
      <div className="flex flex-wrap items-center gap-0.5 border-b bg-slate-50 px-2 py-1">
        <button
          type="button"
          className={btn}
          aria-label="Bold"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => exec('bold')}
        >
          <Bold className="h-4 w-4" />
        </button>
        <button
          type="button"
          className={btn}
          aria-label="Italic"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => exec('italic')}
        >
          <Italic className="h-4 w-4" />
        </button>
        <button
          type="button"
          className={btn}
          aria-label="Underline"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => exec('underline')}
        >
          <Underline className="h-4 w-4" />
        </button>
        <span className="mx-1 h-4 w-px bg-slate-300" />
        <button
          type="button"
          className={btn}
          aria-label="Bulleted list"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => exec('insertUnorderedList')}
        >
          <List className="h-4 w-4" />
        </button>
        <button
          type="button"
          className={btn}
          aria-label="Numbered list"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => exec('insertOrderedList')}
        >
          <ListOrdered className="h-4 w-4" />
        </button>
        <button
          type="button"
          className={btn}
          aria-label="Insert link"
          onMouseDown={(e) => e.preventDefault()}
          onClick={addLink}
        >
          <LinkIcon className="h-4 w-4" />
        </button>
      </div>
      <div
        ref={ref}
        role="textbox"
        aria-multiline="true"
        aria-label={ariaLabel}
        contentEditable
        suppressContentEditableWarning
        data-placeholder={placeholder}
        onInput={emit}
        onBlur={emit}
        onPaste={(event) => insertNormalizedPaste(event, emit)}
        className="rich-text-content min-h-[8rem] max-w-full px-3 py-2 text-sm leading-relaxed outline-none empty:before:text-slate-400 empty:before:content-[attr(data-placeholder)] [overflow-wrap:anywhere] [&_a]:text-brand-600 [&_a]:underline [&_code]:whitespace-pre-wrap [&_ol]:list-decimal [&_ol]:list-inside [&_ol]:pl-5 [&_pre]:whitespace-pre-wrap [&_ul]:list-disc [&_ul]:list-inside [&_ul]:pl-5"
      />
    </div>
  );
}
