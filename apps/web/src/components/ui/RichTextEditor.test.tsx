import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { RichTextEditor as SharedEditor } from './RichTextEditor';
import { RichTextEditor as MastersEditor } from '../../pages/masters/MasterUi';

/**
 * Regression: typing SPACE must not move the caret or corrupt text.
 *
 * Root cause: both shared editors rewrote `innerHTML` on every echoed
 * `value` change. Entity/whitespace normalization (`&nbsp;` vs a raw space)
 * differs textually from the browser's `innerHTML`, so each keystroke reset
 * the DOM and the caret jumped to the start, scrambling typed text.
 * The editors now skip their own echo and only write external changes.
 *
 * Flight → Additional Notes uses the shared ui editor; Hotel → Description
 * uses the masters editor, so covering both editors covers both fields.
 */

function ControlledShared({ initial }: { initial: string }) {
  const [value, setValue] = useState(initial);
  return (
    <>
      <SharedEditor ariaLabel="notes" value={value} onChange={setValue} />
      <output data-testid="mirror">{value}</output>
    </>
  );
}

function ControlledMasters({ initial }: { initial: string }) {
  const [value, setValue] = useState(initial);
  return (
    <>
      <MastersEditor label="Description" value={value} onChange={setValue} />
      <output data-testid="mirror">{value}</output>
    </>
  );
}

/** Counts direct `innerHTML` assignments on an element (i.e. editor resets). */
function countInnerHtmlWrites(el: Element) {
  let proto: object | null = Object.getPrototypeOf(el);
  let descriptor: PropertyDescriptor | undefined;
  while (proto && !descriptor) {
    descriptor = Object.getOwnPropertyDescriptor(proto, 'innerHTML');
    proto = Object.getPrototypeOf(proto);
  }
  if (!descriptor?.get || !descriptor?.set) throw new Error('innerHTML accessor not found');
  let writes = 0;
  const get = descriptor.get!.bind(el);
  const set = descriptor.set!.bind(el);
  Object.defineProperty(el, 'innerHTML', {
    configurable: true,
    get,
    set(next: string) {
      writes += 1;
      set(next);
    },
  });
  return () => writes;
}

/**
 * Google Docs clipboard HTML: hidden `docs-internal-guid` wrapper, paragraph
 * layout (margin / padding / text-indent / line-height), absolute font styles
 * and intentional bold + colour.
 */
const GOOGLE_DOCS_PASTE_HTML =
  '<meta charset="utf-8">' +
  '<b id="docs-internal-guid-1234" style="font-weight:normal;">' +
  '<p style="margin-left:72pt;padding-left:36pt;text-indent:18pt;line-height:1.38;font-family:Arial;font-size:11pt;">' +
  '<span style="font-family:Arial;font-size:11pt;color:#000000;font-weight:700;">Safari Adventure Tram Ride</span>' +
  '</p>' +
  '<p style="margin-left:72pt;line-height:1.38;">' +
  '<span style="font-family:Arial;color:rgb(230,0,0);">Spot a variety of fascinating wildlife</span>' +
  '</p>' +
  '</b>';

/** Dispatch a paste event carrying a `text/html` clipboard flavour. */
function pasteHtml(editor: HTMLElement, html: string) {
  const range = document.createRange();
  range.selectNodeContents(editor);
  range.collapse(false);
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
  const event = new Event('paste', { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'clipboardData', {
    value: { getData: (type: string) => (type === 'text/html' ? html : '') },
  });
  fireEvent(editor, event);
}

function suite(
  name: string,
  renderControlled: (initial: string) => ReturnType<typeof render>,
  role: { name: RegExp; label: string },
) {
  describe(name, () => {
    it('types text, inserts a space in the middle, and keeps content order without resetting', () => {
      const ui = renderControlled('');
      const editor = screen.getByRole('textbox', { name: role.name });
      const writes = countInnerHtmlWrites(editor);
      // Simulate one browser keystroke: the DOM already holds the typed
      // content; firing `input` lets the editor echo it. The sync effect must
      // not perform an additional rewrite (which would reset the caret).
      const type = (html: string) => {
        editor.innerHTML = html;
        const baseline = writes();
        fireEvent.input(editor);
        expect(writes()).toBe(baseline);
      };

      // 1. Type text normally.
      type('Pleasearrange the flight');
      expect(screen.getByTestId('mirror').textContent).toBe('Pleasearrange the flight');

      // 2. Insert a space in the middle. Browsers serialize the preserved
      // space as `&nbsp;`, whose normalized form differs textually and used
      // to trigger a DOM rewrite (caret jump + corrupted order).
      const before = editor;
      type('Please&nbsp;arrange the flight');
      // The emitted value is the browser's serialization, byte-identical.
      expect(screen.getByTestId('mirror').textContent).toBe('Please&nbsp;arrange the flight');

      // 3. Continue typing after the space.
      type('Please&nbsp;arrange the flight for tomorrow');
      const mirror = screen.getByTestId('mirror').textContent;
      expect(mirror).toBe('Please&nbsp;arrange the flight for tomorrow');
      expect(mirror?.indexOf('Please')).toBeLessThan(mirror?.indexOf('tomorrow') ?? 0);

      // 4. No remount/reset on any keystroke: same node, zero effect rewrites.
      expect(screen.getByRole('textbox', { name: role.name })).toBe(before);
      expect(editor.isConnected).toBe(true);
      // Caret-affecting content is byte-stable: no normalization churn.
      expect(editor.innerHTML).toBe('Please&nbsp;arrange the flight for tomorrow');
      ui.unmount();
    });

    it('still displays externally loaded and switched content', () => {
      // Initial load of saved content renders as-is.
      const first = renderControlled('<p>Saved note</p>');
      expect(screen.getByRole('textbox', { name: role.name }).innerHTML).toBe(
        '<p>Saved note</p>',
      );
      first.unmount();

      // Switching sections (a genuinely new external value) updates the editor.
      const second = renderControlled('<p>Other section</p>');
      expect(screen.getByRole('textbox', { name: role.name }).innerHTML).toBe(
        '<p>Other section</p>',
      );
      second.unmount();
    });

    it('keeps formatting controls available', () => {
      renderControlled('');
      expect(screen.getByRole('button', { name: /bold/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /italic/i })).toBeInTheDocument();
    });

    it('normalizes Google Docs HTML on paste while keeping intentional formatting', () => {
      renderControlled('<p>Existing note</p>');
      const editor = screen.getByRole('textbox', { name: role.name });
      pasteHtml(editor, GOOGLE_DOCS_PASTE_HTML);

      const stored = screen.getByTestId('mirror').textContent ?? '';
      // Intent preserved.
      expect(stored).toContain('Safari Adventure Tram Ride');
      expect(stored).toContain('Spot a variety of fascinating wildlife');
      expect(stored).toContain('<strong>');
      expect(stored).toMatch(/rgb\(230,\s*0,\s*0\)/);
      expect(editor.querySelector('strong')?.textContent).toBe('Safari Adventure Tram Ride');
      // Google Docs layout / typography stripped.
      expect(stored).not.toMatch(/margin|padding|text-indent|font-family|font-size|line-height/i);
      expect(stored).not.toContain('docs-internal-guid');
      // Normal paragraphs must never become list items (previous regression).
      expect(editor.querySelector('ul')).toBeNull();
      expect(editor.querySelector('ol')).toBeNull();
      expect(editor.querySelector('li')).toBeNull();
      expect(editor.querySelectorAll('p').length).toBeGreaterThanOrEqual(2);
      // Existing content is untouched.
      expect(editor.textContent).toContain('Existing note');
    });

    it('does not create bullets when pasting a Google Docs paragraph wrapper', () => {
      renderControlled('');
      const editor = screen.getByRole('textbox', { name: role.name });
      pasteHtml(
        editor,
        '<ul style="margin-left:36pt"><p>Paragraph one</p><p>Paragraph two</p></ul>',
      );
      expect(editor.querySelector('ul')).toBeNull();
      expect(editor.querySelector('li')).toBeNull();
      expect(
        Array.from(editor.querySelectorAll('p')).map((p) => p.textContent),
      ).toEqual(['Paragraph one', 'Paragraph two']);
    });

    it('configures Enter to create <p> blocks (no empty paragraph gap)', () => {
      const original = Object.getOwnPropertyDescriptor(document, 'execCommand');
      const execCommand = vi.fn(() => true);
      Object.defineProperty(document, 'execCommand', {
        configurable: true,
        value: execCommand,
      });
      try {
        renderControlled('');
        expect(execCommand).toHaveBeenCalledWith('defaultParagraphSeparator', false, 'p');
      } finally {
        if (original) Object.defineProperty(document, 'execCommand', original);
        else Reflect.deleteProperty(document, 'execCommand');
      }
    });

    it('a. loads stored HTML with an interior <p><br></p> blank paragraph unchanged', () => {
      const stored = '<p>Paragraph 1</p><p><br></p><p>Paragraph 2</p>';
      renderControlled(stored);
      const editor = screen.getByRole('textbox', { name: role.name });
      expect(editor.innerHTML).toBe(stored);
      expect(editor.querySelectorAll('p')).toHaveLength(3);
      expect(editor.querySelectorAll('p')[1]?.querySelector('br')).not.toBeNull();
    });

    it('b. normalizes legacy blank paragraphs to <p><br></p> on load', () => {
      for (const legacy of ['<p></p>', '<p><span></span></p>', '<p>&nbsp;</p>']) {
        const view = renderControlled(`<p>Paragraph 1</p>${legacy}<p>Paragraph 2</p>`);
        const editor = screen.getByRole('textbox', { name: role.name });
        expect(editor.innerHTML).toBe('<p>Paragraph 1</p><p><br></p><p>Paragraph 2</p>');
        expect(editor.querySelectorAll('p')[1]?.querySelector('br')).not.toBeNull();
        view.unmount();
      }
    });

    it('c. trims leading/trailing blank paragraphs on load', () => {
      renderControlled('<p></p><p>Only line</p><p><br></p>');
      expect(screen.getByRole('textbox', { name: role.name }).innerHTML).toBe('<p>Only line</p>');
    });

    it('d. preserves an interior blank paragraph while editing text before/after it', () => {
      renderControlled('<p>Paragraph 1</p><p><br></p><p>Paragraph 2</p>');
      const editor = screen.getByRole('textbox', { name: role.name });
      const edit = (html: string) => {
        editor.innerHTML = html;
        fireEvent.input(editor);
      };

      edit('<p>Paragraph 1 edited</p><p><br></p><p>Paragraph 2</p>');
      expect(screen.getByTestId('mirror').textContent).toBe(
        '<p>Paragraph 1 edited</p><p><br></p><p>Paragraph 2</p>',
      );

      edit('<p>Paragraph 1 edited</p><p><br></p><p>Paragraph 2 edited</p>');
      expect(screen.getByTestId('mirror').textContent).toBe(
        '<p>Paragraph 1 edited</p><p><br></p><p>Paragraph 2 edited</p>',
      );
    });

    it('e. serializes a double-Enter blank paragraph as <p><br></p>', () => {
      // Chrome's double-Enter output is exactly this structure.
      renderControlled('<p>First</p><p><br></p><p>Second</p>');
      const editor = screen.getByRole('textbox', { name: role.name });
      expect(editor.innerHTML).toBe('<p>First</p><p><br></p><p>Second</p>');
      fireEvent.input(editor);
      expect(screen.getByTestId('mirror').textContent).toBe(
        '<p>First</p><p><br></p><p>Second</p>',
      );
    });

    it('f. keeps blank paragraphs across save → reload → edit → save', () => {
      const saved = '<p>Paragraph 1</p><p><br></p><p>Paragraph 2</p>';
      const first = renderControlled(saved);
      const editor = screen.getByRole('textbox', { name: role.name });
      expect(editor.innerHTML).toBe(saved);

      editor.innerHTML = '<p>Paragraph 1</p><p><br></p><p>Paragraph 2 edited</p>';
      fireEvent.input(editor);
      const afterSave = screen.getByTestId('mirror').textContent ?? '';
      expect(afterSave).toBe('<p>Paragraph 1</p><p><br></p><p>Paragraph 2 edited</p>');
      first.unmount();

      // Reload the saved value — the interior blank paragraph is still there.
      renderControlled(afterSave);
      const reloaded = screen.getByRole('textbox', { name: role.name });
      expect(reloaded.innerHTML).toBe(afterSave);

      reloaded.innerHTML = '<p>Paragraph 1 edited</p><p><br></p><p>Paragraph 2 edited</p>';
      fireEvent.input(reloaded);
      expect(screen.getByTestId('mirror').textContent).toBe(
        '<p>Paragraph 1 edited</p><p><br></p><p>Paragraph 2 edited</p>',
      );
    });

    it('keeps real lists as lists and never turns blank paragraphs into bullets', () => {
      renderControlled(
        '<p>Paragraph 1</p><p><br></p><p>Paragraph 2</p><ul><li>Item</li></ul><ol><li>First</li></ol>',
      );
      const editor = screen.getByRole('textbox', { name: role.name });
      expect(editor.querySelectorAll('ul')).toHaveLength(1);
      expect(editor.querySelectorAll('ol')).toHaveLength(1);
      expect(editor.querySelectorAll('ul > li')).toHaveLength(1);
      // Blank paragraph is a paragraph, never a list item.
      expect(editor.querySelectorAll('p')[1]?.textContent).toBe('');
      expect(editor.querySelectorAll('li')).toHaveLength(2);
    });
  });
}

suite('shared ui RichTextEditor (Flight Additional Notes)', (initial: string) =>
  render(<ControlledShared initial={initial} />),
{ name: /notes/i, label: 'notes' },
);

suite('masters RichTextEditor (Hotel Description)', (initial: string) =>
  render(<ControlledMasters initial={initial} />),
{ name: /description/i, label: 'Description' },
);

/**
 * Regression: bullet / numbered-list markers were partially clipped at the
 * left edge of the policy editors. Markers are painted in the `list-inside`
 * content box, so a wide (2+ digit) or otherwise long marker can never be
 * cut off by an ancestor `overflow-hidden` wrapper. jsdom cannot verify
 * painted clipping, so this asserts the utility classes driving that fix.
 */
describe('shared ui RichTextEditor list marker visibility', () => {
  it('positions list markers inside the content box for ul and ol', () => {
    render(<ControlledShared initial="<ul><li>Bullet</li></ul><ol><li>Number</li></ol>" />);
    const editor = screen.getByRole('textbox', { name: /notes/i });
    expect(editor.className).toContain('[&_ul]:list-inside');
    expect(editor.className).toContain('[&_ol]:list-inside');
    expect(editor.className).toContain('[&_ul]:list-disc');
    expect(editor.className).toContain('[&_ol]:list-decimal');
  });
});

describe('masters RichTextEditor numbered list (Terms & Conditions)', () => {
  const renderTerms = (initial: string) => render(<ControlledMasters initial={initial} />);
  const editorOf = () => screen.getByRole('textbox', { name: /description/i });

  function selectParagraphs(editor: HTMLElement, fromIndex: number, toIndex: number) {
    const paragraphs = editor.querySelectorAll('p');
    const range = document.createRange();
    range.setStart(paragraphs[fromIndex]!, 0);
    range.setEnd(paragraphs[toIndex]!, paragraphs[toIndex]!.childNodes.length);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    document.dispatchEvent(new Event('selectionchange'));
  }

  it('converts selected paragraphs into a sequential ordered list', () => {
    const ui = renderTerms('<p>Check-in after 2 PM.</p><p>No smoking.</p><p>No pets.</p>');
    const editor = editorOf();
    selectParagraphs(editor, 0, 2);
    fireEvent.click(screen.getByRole('button', { name: /numbered list/i }));
    const items = editor.querySelectorAll('ol > li');
    expect(items).toHaveLength(3);
    expect(Array.from(items).map((li) => li.textContent)).toEqual([
      'Check-in after 2 PM.',
      'No smoking.',
      'No pets.',
    ]);
    // Saved HTML is a real ordered list — never numbers baked into text.
    expect(screen.getByTestId('mirror').textContent).toContain('<ol>');
    expect(screen.getByTestId('mirror').textContent).not.toContain('1. Check-in');
    ui.unmount();
  });

  it('toggles ordered-list formatting off and marks the button pressed while listed', () => {
    const ui = renderTerms('<p>One</p><p>Two</p>');
    const editor = editorOf();
    const toggle = screen.getByRole('button', { name: /numbered list/i });
    selectParagraphs(editor, 0, 1);
    fireEvent.click(toggle);
    expect(editor.querySelectorAll('ol > li')).toHaveLength(2);
    expect(toggle).toHaveAttribute('aria-pressed', 'true');
    // Select inside the list, toggle off: paragraphs return, no list remains.
    const range = document.createRange();
    range.selectNodeContents(editor.querySelector('li')!);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    fireEvent.click(toggle);
    expect(editor.querySelector('ol')).toBeNull();
    expect(Array.from(editor.querySelectorAll('p')).map((p) => p.textContent)).toEqual([
      'One',
      'Two',
    ]);
    ui.unmount();
  });

  it('preserves numbering across save and reload without doubling', () => {
    const first = renderTerms('<p>One</p><p>Two</p>');
    const editor = editorOf();
    selectParagraphs(editor, 0, 1);
    fireEvent.click(screen.getByRole('button', { name: /numbered list/i }));
    const saved = screen.getByTestId('mirror').textContent ?? '';
    expect(saved).toContain('<ol>');
    first.unmount();
    renderTerms(saved);
    const reloaded = editorOf();
    expect(reloaded.querySelectorAll('ol > li')).toHaveLength(2);
    // Saving again without edits keeps the single list intact.
    fireEvent.input(reloaded);
    expect(screen.getByTestId('mirror').textContent).toContain('<ol>');
    expect((screen.getByTestId('mirror').textContent?.match(/<ol>/g) ?? []).length).toBe(1);
  });

  it('leaves plain unnumbered paragraphs and bullets untouched', () => {
    const ui = renderTerms('<p>Plain line one.</p><p>Plain line two.</p>');
    const editor = editorOf();
    expect(editor.querySelector('ol')).toBeNull();
    expect(editor.textContent).toContain('Plain line one.');
    ui.unmount();
    const bulleted = renderTerms('<ul><li>No smoking</li><li>No pets</li></ul>');
    const list = editorOf();
    expect(list.querySelectorAll('ul > li')).toHaveLength(2);
    expect(list.querySelector('ol')).toBeNull();
    bulleted.unmount();
  });
});
