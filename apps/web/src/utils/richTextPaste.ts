/**
 * Clipboard-HTML normalizer for the shared rich-text editors.
 *
 * When staff copy from Google Docs (or Word / Outlook) the clipboard carries
 * arbitrary page layout and typography: hidden `docs-internal-guid` wrappers,
 * per-paragraph `margin`/`padding`, `text-indent`, absolute
 * `font-family`/`font-size`/`line-height`, `mso-*` properties, layout tables
 * and stray `<br>`. Inserted verbatim that content floated far from the
 * editor's left edge, spaced paragraphs inconsistently and dragged foreign
 * fonts into the CRM.
 *
 * `normalizePastedHtml` flattens those wrappers into the CRM's own block
 * structure (`p`, headings, lists, blockquote, pre) and maps the *intentional*
 * inline formatting (bold / italic / underline / strike / colour / highlight /
 * links / alignment) onto the semantic tags the editors already produce.
 * Everything else is discarded. The result is safe to store and render, and
 * because it is shared it applies uniformly to Sightseeing Description, Hotel
 * Description, Flight Additional Notes and every other rich-text field.
 *
 * The pasted HTML itself is rewritten here — this is not a CSS workaround.
 */

/** Elements whose entire subtree is discarded (metadata, scripts, non-text UI). */
const DROP_TAGS = new Set([
  'script',
  'style',
  'meta',
  'link',
  'title',
  'head',
  'base',
  'noscript',
  'iframe',
  'frame',
  'frameset',
  'noframes',
  'object',
  'embed',
  'param',
  'applet',
  'form',
  'input',
  'button',
  'select',
  'option',
  'optgroup',
  'textarea',
  'label',
  'fieldset',
  'legend',
  'svg',
  'canvas',
  'video',
  'audio',
  'source',
  'track',
  'map',
  'area',
  'template',
  'img',
  'picture',
  'dialog',
  'slot',
  'portal',
]);

/** Block-level tags that become CRM block elements. */
const BLOCK_TAGS = new Set([
  'p',
  'div',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'blockquote',
  'pre',
]);

/** Table/layout wrappers that are flattened to their children. */
const TABLE_WRAPPER_TAGS = new Set([
  'table',
  'thead',
  'tbody',
  'tfoot',
  'tr',
  'caption',
  'colgroup',
  'col',
]);

/** Table cell tags behave like block containers (unwrapped or turned into p). */
const TABLE_CELL_TAGS = new Set(['td', 'th']);

/** Inline tags preserved as-is (their attributes are dropped). */
const KEEP_INLINE_TAGS = new Set(['code', 'sub', 'sup', 'mark', 'samp', 'kbd', 'var']);

const BOLD_TAGS = new Set(['b', 'strong']);
const ITALIC_TAGS = new Set(['i', 'em']);
const UNDERLINE_TAGS = new Set(['u', 'ins']);
const STRIKE_TAGS = new Set(['s', 'strike', 'del']);

/** Block elements that are safe to prune when they carry no visible content. */
const STRUCTURAL_BLOCKS = new Set([...BLOCK_TAGS, 'ul', 'ol', 'li', 'hr']);

const ALLOWED_ALIGN = new Set(['left', 'center', 'right', 'justify']);

const COLOR_PATTERN = /^(#[0-9a-fA-F]{3,8}|rgba?\([^)]+\)|hsla?\([^)]+\)|[a-zA-Z]+)$/;

interface Format {
  bold: boolean;
  italic: boolean;
  underline: boolean;
  strike: boolean;
  color: string | null;
  background: string | null;
}

interface Context {
  pre: boolean;
  inListItem: boolean;
  /** Collapse nested lists to paragraphs (used while flattening a fake list). */
  listFlatten: boolean;
}

const EMPTY_FORMAT: Format = {
  bold: false,
  italic: false,
  underline: false,
  strike: false,
  color: null,
  background: null,
};

function parseStyle(el: Element): Record<string, string> {
  const raw = el.getAttribute('style') ?? '';
  const declarations: Record<string, string> = {};
  for (const part of raw.split(';')) {
    const separator = part.indexOf(':');
    if (separator === -1) continue;
    const property = part.slice(0, separator).trim().toLowerCase();
    const value = part.slice(separator + 1).trim();
    if (property && value) declarations[property] = value;
  }
  return declarations;
}

function isHidden(style: Record<string, string>): boolean {
  const display = style['display'];
  if (display && display.toLowerCase().includes('none')) return true;
  const visibility = style['visibility'];
  return Boolean(visibility && visibility.toLowerCase() === 'hidden');
}

/**
 * Drops colours that carry no intent: transparent, inherited, pure black and
 * the all-zero rgba Google Docs emits for default text. Everything else is
 * kept so intentional text/highlight colours survive the paste.
 */
function normalizeColor(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const lower = trimmed.toLowerCase();
  if (
    ['transparent', 'inherit', 'initial', 'unset', 'currentcolor', 'none'].includes(lower)
  ) {
    return null;
  }
  if (/^rgba?\(\s*0\s*,\s*0\s*,\s*0(?:\s*,\s*0(?:\.0+)?)?\s*\)$/.test(lower)) return null;
  if (/^#(?:000|000000|00000000)$/.test(lower) || lower === 'black') return null;
  if (!COLOR_PATTERN.test(trimmed)) return null;
  return trimmed;
}

function styleWeight(style: Record<string, string>): boolean | null {
  const raw = style['font-weight'];
  if (!raw) return null;
  const value = raw.trim().toLowerCase();
  if (value === 'bold' || value === 'bolder') return true;
  if (value === 'normal' || value === 'lighter') return false;
  const weight = Number.parseInt(value, 10);
  return Number.isNaN(weight) ? null : weight >= 600;
}

function styleItalic(style: Record<string, string>): boolean | null {
  const raw = style['font-style'];
  if (!raw) return null;
  const value = raw.toLowerCase();
  if (value.includes('italic') || value.includes('oblique')) return true;
  if (value.includes('normal')) return false;
  return null;
}

function textDecoration(style: Record<string, string>): string | null {
  return style['text-decoration-line'] ?? style['text-decoration'] ?? null;
}

function mergeFormat(
  parent: Format,
  tag: string,
  style: Record<string, string>,
  el: Element,
): Format {
  const format: Format = { ...parent };

  const weight = styleWeight(style);
  if (weight !== null) format.bold = weight;
  else if (BOLD_TAGS.has(tag)) format.bold = true;

  const italic = styleItalic(style);
  if (italic !== null) format.italic = italic;
  else if (ITALIC_TAGS.has(tag)) format.italic = true;

  const decoration = textDecoration(style);
  if (decoration) {
    const lower = decoration.toLowerCase();
    format.underline = lower.includes('underline');
    format.strike = lower.includes('line-through');
  } else {
    if (UNDERLINE_TAGS.has(tag)) format.underline = true;
    if (STRIKE_TAGS.has(tag)) format.strike = true;
  }

  const color = tag === 'font' ? el.getAttribute('color') ?? style['color'] : style['color'];
  if (color) format.color = normalizeColor(color);

  const background = style['background-color'] ?? style['background'];
  if (background) format.background = normalizeColor(background);

  return format;
}

function wrapElement(doc: Document, tag: string, child: Node, styles?: string): Element {
  const el = doc.createElement(tag);
  if (styles) el.setAttribute('style', styles);
  el.appendChild(child);
  return el;
}

function formatText(doc: Document, text: string, format: Format): Node {
  let node: Node = doc.createTextNode(text);
  if (format.strike) node = wrapElement(doc, 's', node);
  if (format.underline) node = wrapElement(doc, 'u', node);
  if (format.italic) node = wrapElement(doc, 'em', node);
  if (format.bold) node = wrapElement(doc, 'strong', node);
  const styles: string[] = [];
  if (format.color) styles.push(`color: ${format.color}`);
  if (format.background) styles.push(`background-color: ${format.background}`);
  if (styles.length) node = wrapElement(doc, 'span', node, styles.join('; '));
  return node;
}

function isBlockTag(tag: string): boolean {
  return BLOCK_TAGS.has(tag) || TABLE_CELL_TAGS.has(tag);
}

function hasBlockChild(el: Element): boolean {
  return Array.from(el.children).some((child) => isBlockTag(child.tagName.toLowerCase()));
}

function isBlockBoundary(node: Node | null): boolean {
  if (!node) return true;
  if (node.nodeType !== 1) return false;
  const tag = (node as Element).tagName.toLowerCase();
  return isBlockTag(tag) || TABLE_WRAPPER_TAGS.has(tag);
}

function hasVisibleContent(el: Node): boolean {
  if ((el.textContent ?? '').replace(/[\s\u00a0]+/g, '') !== '') return true;
  for (const child of Array.from(el.childNodes)) {
    if (child.nodeType !== 1) continue;
    const tag = (child as Element).tagName.toLowerCase();
    if (tag === 'br') continue;
    if (tag === 'hr') return true;
    if (hasVisibleContent(child)) return true;
  }
  return false;
}

/**
 * True when an empty source block represents a blank line rather than layout
 * junk. An empty `<p>` is always a paragraph — word processors use exactly that
 * for an Enter-created blank line — while an empty `<div>` only counts when it
 * explicitly encodes a break (a lone <br> or a whitespace/nbsp run); a bare
 * `<div></div>` is a layout wrapper. Leading/trailing blanks are trimmed by
 * cleanup(), so only intentional interior spacing survives.
 */
function isBlankParagraphBlock(tag: string, el: Element): boolean {
  if (tag === 'p') return true;
  if (el.querySelector('br')) return true;
  const text = el.textContent ?? '';
  return text.length > 0 && text.trim() === '';
}

function applyAlignment(block: Element, style: Record<string, string>, source: Element) {
  const align = (style['text-align'] ?? source.getAttribute('align') ?? '').trim().toLowerCase();
  if (ALLOWED_ALIGN.has(align) && align !== 'left') {
    block.setAttribute('style', `text-align: ${align}`);
  }
}

/** Parse a CSS length into pixels (approximate for absolute units). */
function lengthToPx(value: string): number {
  const raw = value.trim().toLowerCase();
  if (!raw || raw.endsWith('%')) return 0;
  const amount = Number.parseFloat(raw);
  if (!Number.isFinite(amount) || amount <= 0) return 0;
  if (raw.endsWith('pt')) return amount * (96 / 72);
  if (raw.endsWith('pc')) return amount * 16;
  if (raw.endsWith('em') || raw.endsWith('rem')) return amount * 16;
  if (raw.endsWith('cm')) return amount * (96 / 2.54);
  if (raw.endsWith('mm')) return amount * (96 / 25.4);
  if (raw.endsWith('in')) return amount * 96;
  return amount;
}

/** Vertical (`margin-top` / `margin-bottom`) edges of a block, in pixels. */
function verticalMarginEdges(style: Record<string, string>): { top: number; bottom: number } {
  let top = lengthToPx(style['margin-top'] ?? '');
  let bottom = lengthToPx(style['margin-bottom'] ?? '');
  const shorthand = style['margin'];
  if (shorthand) {
    const parts = shorthand.split(/\s+/).filter(Boolean);
    if (parts[0]) top = lengthToPx(parts[0]);
    if (parts.length >= 3 && parts[2]) bottom = lengthToPx(parts[2]);
    else if (parts.length === 2 && parts[1]) bottom = lengthToPx(parts[1]);
  }
  return { top, bottom };
}

/**
 * Google Docs records paragraph spacing as inline `margin-top`/`margin-bottom`
 * in points (headings/sections ~11-18pt, "space after paragraph" ~5-11pt, plain
 * body text 0pt). Those vertical margins are meaningful spacing — unlike the
 * horizontal `margin-left` indentation, which is layout. We do not import the
 * raw point value: instead the block is flagged so an adjacent pair of
 * paragraphs is separated by a CRM-native blank paragraph. Tiny/zero values are
 * ignored so default body text gains no spacing.
 */
const MIN_MEANINGFUL_MARGIN_PX = 4;

function markParagraphSpacing(block: Element, style: Record<string, string>) {
  const { top, bottom } = verticalMarginEdges(style);
  if (top >= MIN_MEANINGFUL_MARGIN_PX) block.setAttribute('data-space-before', '1');
  if (bottom >= MIN_MEANINGFUL_MARGIN_PX) block.setAttribute('data-space-after', '1');
}

function sanitizeUrl(raw: string | null): string | null {
  if (!raw) return null;
  const url = raw.trim();
  if (!url) return null;
  if (/^(https?:|mailto:|tel:)/i.test(url)) return url;
  if (url.startsWith('#') || url.startsWith('/')) return url;
  return null;
}

function processChildren(
  source: Node,
  format: Format,
  target: Node,
  doc: Document,
  context: Context,
) {
  const children = Array.from(source.childNodes);
  children.forEach((child, index) => {
    if (child.nodeType === 3) {
      let text = child.nodeValue ?? '';
      if (!context.pre) {
        // Google Docs wraps every run in `white-space: pre-wrap`; collapse the
        // source's line breaks/indentation so they do not become stray spaces.
        text = text.replace(/[ \t\n\r]+/g, ' ');
        if (!text) return;
        if (text === ' ') {
          const previous = children[index - 1] ?? null;
          const next = children[index + 1] ?? null;
          if (isBlockBoundary(previous) || isBlockBoundary(next)) return;
        }
      } else if (!text) {
        return;
      }
      target.appendChild(formatText(doc, text, format));
      return;
    }
    if (child.nodeType !== 1) return;
    processElement(child as Element, format, target, doc, context);
  });
}

function isListTag(tag: string): boolean {
  return tag === 'ul' || tag === 'ol';
}

function isListItem(el: Element): boolean {
  return el.tagName.toLowerCase() === 'li';
}

/**
 * Google Docs (and Word) reuse `<ul>`/`<ol>` with `list-style-type: none` — or
 * bare `<li>` siblings — purely to indent normal paragraphs. Such wrappers must
 * NOT become bullet lists; the marker is explicitly suppressed, so the content
 * is paragraph text.
 */
function hasSuppressedMarker(el: Element): boolean {
  const style = parseStyle(el);
  const value = `${style['list-style-type'] ?? ''} ${style['list-style'] ?? ''}`
    .trim()
    .toLowerCase();
  if (!value) return false;
  if (value === 'none') return true;
  return /(?:^|\s)none(?:\s|$)/.test(value);
}

function createListItem(li: Element, parentFormat: Format, doc: Document, context: Context) {
  const item = doc.createElement('li');
  const format = mergeFormat(parentFormat, 'li', parseStyle(li), li);
  processChildren(li, format, item, doc, { ...context, inListItem: true });
  return item;
}

/**
 * Flattens a list that is not semantically a list (layout/indentation wrapper,
 * marker-suppressed items) into ordinary paragraphs. No bullets are invented.
 */
function flattenList(el: Element, format: Format, target: Node, doc: Document, context: Context) {
  const downContext: Context = { ...context, inListItem: true, listFlatten: true };
  for (const child of Array.from(el.childNodes)) {
    if (child.nodeType === 1) {
      const childEl = child as Element;
      const childTag = childEl.tagName.toLowerCase();
      if (childTag === 'li') {
        const paragraph = doc.createElement('p');
        const liFormat = mergeFormat(format, 'li', parseStyle(childEl), childEl);
        processChildren(childEl, liFormat, paragraph, doc, downContext);
        if (hasVisibleContent(paragraph)) {
          target.appendChild(paragraph);
        } else {
          // Google Docs wraps indented body paragraphs in `<ul><li
          // style="list-style-type:none">`, and records a blank line between
          // them as an empty item `<li><br/></li>`. Such an item is an
          // intentional blank line, not junk — preserve it as a CRM-native
          // blank paragraph. (Leading/trailing empties are still trimmed.)
          paragraph.replaceChildren(doc.createElement('br'));
          target.appendChild(paragraph);
        }
        continue;
      }
      if (isListTag(childTag)) {
        flattenList(childEl, format, target, doc, context);
        continue;
      }
      processElement(childEl, format, target, doc, context);
      continue;
    }
    if (child.nodeType === 3) {
      const text = (child.nodeValue ?? '').replace(/[\s\u00a0]+/g, ' ').trim();
      if (!text) continue;
      const paragraph = doc.createElement('p');
      paragraph.appendChild(formatText(doc, text, format));
      target.appendChild(paragraph);
    }
  }
}

/**
 * Emits a semantic list. Only real `<li>` children become list items; any other
 * block inside the container is treated as a normal block (never wrapped in an
 * `<li>`), and Google Docs' "nested list is a sibling of its item" quirk is
 * re-nested under the preceding item.
 */
function processListElement(
  el: Element,
  tag: string,
  format: Format,
  target: Node,
  doc: Document,
  context: Context,
) {
  const children = Array.from(el.childNodes);
  const items = children.filter(
    (child): child is Element => child.nodeType === 1 && isListItem(child as Element),
  );
  const semantic = !hasSuppressedMarker(el) && items.some((item) => !hasSuppressedMarker(item));

  if (!semantic) {
    flattenList(el, format, target, doc, context);
    return;
  }

  let list = doc.createElement(tag);
  let currentItem: Element | null = null;
  const flush = () => {
    if (list.childNodes.length) target.appendChild(list);
    list = doc.createElement(tag);
    currentItem = null;
  };

  for (const child of children) {
    if (child.nodeType === 1) {
      const childEl = child as Element;
      const childTag = childEl.tagName.toLowerCase();
      if (childTag === 'li') {
        const item = createListItem(childEl, format, doc, context);
        // Drop empty list items (Google Docs artifacts) so no bare bullet is
        // invented; a following nested list still attaches to the prior item.
        if (hasVisibleContent(item)) {
          list.appendChild(item);
          currentItem = item;
        }
        continue;
      }
      if (isListTag(childTag)) {
        if (currentItem) {
          processListElement(childEl, childTag, format, currentItem, doc, context);
        } else {
          flush();
          processListElement(childEl, childTag, format, target, doc, context);
        }
        continue;
      }
      if (isBlockTag(childTag) || TABLE_WRAPPER_TAGS.has(childTag)) {
        // A real block inside a list container is not a list item.
        flush();
        processElement(childEl, format, target, doc, context);
        continue;
      }
      if (currentItem) {
        processElement(childEl, format, currentItem, doc, context);
      } else {
        const paragraph = doc.createElement('p');
        processElement(childEl, format, paragraph, doc, context);
        if (hasVisibleContent(paragraph)) target.appendChild(paragraph);
      }
      continue;
    }
    if (child.nodeType === 3) {
      const text = (child.nodeValue ?? '').replace(/[\s\u00a0]+/g, ' ').trim();
      if (!text) continue;
      if (currentItem) {
        currentItem.appendChild(formatText(doc, text, format));
      } else {
        const paragraph = doc.createElement('p');
        paragraph.appendChild(formatText(doc, text, format));
        target.appendChild(paragraph);
      }
    }
  }
  flush();
}

function processElement(
  el: Element,
  parentFormat: Format,
  target: Node,
  doc: Document,
  context: Context,
) {
  const tag = el.tagName.toLowerCase();

  if (DROP_TAGS.has(tag)) return;
  if (el.hasAttribute('hidden')) return;
  if ((el.getAttribute('aria-hidden') ?? '').toLowerCase() === 'true') return;

  const style = parseStyle(el);
  if (isHidden(style)) return;

  if (tag === 'br') {
    target.appendChild(doc.createElement('br'));
    return;
  }

  if (tag === 'hr') {
    target.appendChild(doc.createElement('hr'));
    return;
  }

  if (TABLE_WRAPPER_TAGS.has(tag)) {
    processChildren(el, parentFormat, target, doc, context);
    return;
  }

  if (isListTag(tag)) {
    if (context.listFlatten) {
      flattenList(el, parentFormat, target, doc, context);
    } else {
      processListElement(el, tag, parentFormat, target, doc, context);
    }
    return;
  }

  if (tag === 'li') {
    // A genuine list item always has a <ul>/<ol> parent in the clipboard HTML.
    // A bare <li> is a layout artifact, so render its content as a paragraph
    // instead of inventing a bullet.
    const paragraph = doc.createElement('p');
    const liFormat = mergeFormat(parentFormat, 'li', style, el);
    processChildren(el, liFormat, paragraph, doc, { ...context, inListItem: true });
    if (hasVisibleContent(paragraph)) target.appendChild(paragraph);
    return;
  }

  const format = mergeFormat(parentFormat, tag, style, el);

  if (BLOCK_TAGS.has(tag)) {
    // Paragraphs inside a list item must not add block spacing.
    if ((tag === 'p' || tag === 'div') && context.inListItem) {
      processChildren(el, format, target, doc, context);
      return;
    }
    // A <div> that only wraps other blocks is layout, not a paragraph.
    if (tag === 'div' && hasBlockChild(el)) {
      processChildren(el, format, target, doc, context);
      return;
    }
    if (tag === 'p' || tag === 'div') {
      const paragraph = doc.createElement('p');
      applyAlignment(paragraph, style, el);
      markParagraphSpacing(paragraph, style);
      processChildren(el, format, paragraph, doc, context);
      if (hasVisibleContent(paragraph)) {
        target.appendChild(paragraph);
      } else if (!context.inListItem && isBlankParagraphBlock(tag, el)) {
        // Preserve the source's intentional blank line as a CRM-native blank
        // paragraph instead of deleting the user's paragraph spacing. A blank
        // paragraph is a real edit, not junk, so it must survive the paste and
        // render in the read-only/detail and weblink views.
        paragraph.replaceChildren(doc.createElement('br'));
        target.appendChild(paragraph);
      }
      return;
    }
    const block = doc.createElement(tag);
    applyAlignment(block, style, el);
    processChildren(el, format, block, doc, { ...context, pre: tag === 'pre' });
    if (hasVisibleContent(block)) target.appendChild(block);
    return;
  }

  if (TABLE_CELL_TAGS.has(tag)) {
    if (hasBlockChild(el)) {
      processChildren(el, format, target, doc, context);
      return;
    }
    const paragraph = doc.createElement('p');
    applyAlignment(paragraph, style, el);
    processChildren(el, format, paragraph, doc, context);
    if (hasVisibleContent(paragraph)) target.appendChild(paragraph);
    return;
  }

  if (tag === 'a') {
    const anchor = doc.createElement('a');
    const href = sanitizeUrl(el.getAttribute('href'));
    if (href) anchor.setAttribute('href', href);
    processChildren(el, format, anchor, doc, context);
    if (anchor.childNodes.length) target.appendChild(anchor);
    return;
  }

  if (KEEP_INLINE_TAGS.has(tag)) {
    const inline = doc.createElement(tag);
    processChildren(el, format, inline, doc, context);
    if (inline.childNodes.length) target.appendChild(inline);
    return;
  }

  // span / font / unknown inline wrapper: flatten into the parent while
  // carrying the formatting that was merged above.
  processChildren(el, format, target, doc, context);
}

function isElement(node: Node | null): node is Element {
  return node !== null && node.nodeType === 1;
}

function isBr(node: Node | null): boolean {
  return isElement(node) && node.tagName.toLowerCase() === 'br';
}

function isEmptyBlock(node: Node | null): boolean {
  if (!isElement(node)) return false;
  const tag = node.tagName.toLowerCase();
  if (!STRUCTURAL_BLOCKS.has(tag)) return false;
  return !hasVisibleContent(node);
}

function removeSurroundingEmptyNodes(root: Element) {
  while (root.firstChild && (isBr(root.firstChild) || isEmptyBlock(root.firstChild))) {
    root.removeChild(root.firstChild);
  }
  while (root.lastChild && (isBr(root.lastChild) || isEmptyBlock(root.lastChild))) {
    root.removeChild(root.lastChild);
  }
}

function collapseBreaks(root: Element) {
  for (const child of Array.from(root.children)) {
    let run = 0;
    for (const node of Array.from(child.childNodes)) {
      if (isBr(node)) {
        run += 1;
        if (run > 2) node.parentNode?.removeChild(node);
      } else {
        run = 0;
      }
    }
    collapseBreaks(child);
  }
}

function isBlankOutputParagraph(el: Element): boolean {
  if (el.tagName.toLowerCase() !== 'p') return false;
  if (el.querySelector('br')) return true;
  return (el.textContent ?? '').replace(/[\s\u00a0]+/g, '') === '';
}

/**
 * Turns the per-paragraph spacing flags collected while parsing into real blank
 * paragraphs, so the source's intentional spacing is stored in the CRM's own
 * representation (an empty `<p><br></p>`), never as margins and never applied to
 * paragraphs the source left tight. Only adjacent paragraphs are spaced (a gap
 * after a heading or around a list is left to those elements), and an existing
 * blank paragraph is never doubled.
 */
function applyParagraphSpacing(root: Element) {
  const doc = root.ownerDocument;
  let pendingSpace = false;
  for (const child of Array.from(root.children)) {
    const isParagraph = child.tagName.toLowerCase() === 'p';
    const blank = isParagraph && isBlankOutputParagraph(child);
    const spaceBefore = child.getAttribute('data-space-before') === '1';
    const spaceAfter = child.getAttribute('data-space-after') === '1';

    if (isParagraph && !blank && (pendingSpace || spaceBefore)) {
      const previous = child.previousElementSibling;
      if (
        previous &&
        previous.tagName.toLowerCase() === 'p' &&
        !isBlankOutputParagraph(previous)
      ) {
        const spacer = doc.createElement('p');
        spacer.appendChild(doc.createElement('br'));
        root.insertBefore(spacer, child);
      }
    }

    pendingSpace = isParagraph && !blank ? spaceAfter : false;
  }

  // The flags are an internal build detail — never leak them into saved HTML.
  for (const marked of Array.from(
    root.querySelectorAll('[data-space-before],[data-space-after]'),
  )) {
    marked.removeAttribute('data-space-before');
    marked.removeAttribute('data-space-after');
  }
}

function cleanup(root: Element) {
  // Translate Google Docs paragraph margins into CRM-native blank paragraphs
  // before trimming, then trim clipboard junk at the edges and cap runaway
  // <br> runs. Blank paragraphs *between* content are kept so intentional
  // spacing survives to the stored HTML, the editors and the weblink.
  applyParagraphSpacing(root);
  removeSurroundingEmptyNodes(root);
  collapseBreaks(root);
  removeSurroundingEmptyNodes(root);
}

/** Normalizes clipboard HTML into CRM-native rich-text markup. */
export function normalizePastedHtml(html: string): string {
  if (!html || !html.trim()) return '';
  const parsed = new DOMParser().parseFromString(html, 'text/html');
  const output = parsed.createElement('div');
  processChildren(parsed.body, EMPTY_FORMAT, output, parsed, {
    pre: false,
    inListItem: false,
    listFlatten: false,
  });
  cleanup(output);
  return output.innerHTML;
}

/**
 * Materialises intentional blank lines for read-only rendering.
 *
 * A contentEditable shows an empty `<p></p>` as a blank line, but a static
 * `dangerouslySetInnerHTML` render collapses it to zero height — which is how
 * paragraph spacing recorded by the editor went missing in the Master Detail
 * and weblink views. Giving each empty paragraph a real `<br>` restores the
 * blank line using the surrounding line-height, without adding any margin
 * between non-empty paragraphs.
 */
export interface BlankParagraphOptions {
  /**
   * Remove leading/trailing blank paragraphs (clipboard junk). Interior blank
   * paragraphs are always preserved.
   */
  trimEdges?: boolean;
}

/**
 * True for nodes that only represent empty space: a `<br>`, a blank
 * paragraph/div, or a whitespace-only text node.
 */
function isBlankBlockNode(node: Node | null): boolean {
  if (!node) return false;
  if (node.nodeType === 3) return (node.nodeValue ?? '').trim() === '';
  if (node.nodeType !== 1) return false;
  const el = node as Element;
  const tag = el.tagName.toLowerCase();
  if (tag === 'br') return true;
  if (tag !== 'p' && tag !== 'div') return false;
  if (el.querySelector('br')) return true;
  return (el.textContent ?? '').replace(/[\s\u00a0]+/g, '') === '';
}

export function ensureBlankParagraphs(
  html: string,
  { trimEdges = false }: BlankParagraphOptions = {},
): string {
  if (!html || typeof DOMParser === 'undefined' || !html.includes('<p')) return html;
  const parsed = new DOMParser().parseFromString(html, 'text/html');
  const { body } = parsed;
  for (const paragraph of Array.from(body.querySelectorAll('p'))) {
    if (paragraph.querySelector('br')) continue;
    if ((paragraph.textContent ?? '').replace(/[\s\u00a0]+/g, '') !== '') continue;
    // Drop any empty inline wrappers (`<span></span>` etc.) and make the blank
    // line explicit, so it is a canonical `<p><br></p>`.
    paragraph.replaceChildren(parsed.createElement('br'));
  }
  if (trimEdges) {
    while (body.firstChild && isBlankBlockNode(body.firstChild)) {
      body.removeChild(body.firstChild);
    }
    while (body.lastChild && isBlankBlockNode(body.lastChild)) {
      body.removeChild(body.lastChild);
    }
  }
  return body.innerHTML;
}

function insertHtmlAtSelection(html: string) {
  const selection = typeof window !== 'undefined' ? window.getSelection() : null;
  if (!selection || selection.rangeCount === 0) return;
  const range = selection.getRangeAt(0);
  range.deleteContents();
  const fragment = range.createContextualFragment(html);
  const last = fragment.lastChild;
  range.insertNode(fragment);
  if (last) {
    range.setStartAfter(last);
    range.collapse(true);
    selection.removeAllRanges();
    selection.addRange(range);
  }
}

function insertHtml(html: string) {
  let inserted = false;
  try {
    if (typeof document.execCommand === 'function') {
      inserted = document.execCommand('insertHTML', false, html);
    }
  } catch {
    inserted = false;
  }
  if (!inserted) insertHtmlAtSelection(html);
}

/**
 * Intercepts a paste event, normalizes the `text/html` flavour and inserts the
 * cleaned markup at the caret. Returns `true` when the event was handled (the
 * caller should not run its own paste logic); `false` lets the browser handle
 * plain-text / image pastes untouched.
 */
export function insertNormalizedPaste(
  event: { clipboardData: DataTransfer | null; preventDefault: () => void },
  onInserted?: () => void,
): boolean {
  const clipboard = event.clipboardData;
  if (!clipboard) return false;
  const html = clipboard.getData('text/html');
  if (!html || !html.trim()) return false;
  const normalized = normalizePastedHtml(html);
  event.preventDefault();
  if (!normalized) return true;
  insertHtml(normalized);
  onInserted?.();
  return true;
}
