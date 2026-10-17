import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ensureBlankParagraphs, normalizePastedHtml, wrapOrphanListItems } from './richTextPaste';

/**
 * Regression coverage for Google Docs → shared editor paste normalization.
 * The fixture mirrors the HTML Google Docs puts on the clipboard: a hidden
 * `docs-internal-guid` <b> wrapper, per-paragraph layout (margin / padding /
 * text-indent / line-height), absolute font-family and font-size, and the
 * intentional inline formatting we must keep.
 */
const GOOGLE_DOCS_HTML = `
<meta charset="utf-8">
<b id="docs-internal-guid-1234" style="font-weight:normal;">
  <p dir="ltr" style="line-height:1.38;margin-top:0pt;margin-bottom:0pt;margin-left:72pt;padding-left:36pt;text-indent:18pt;">
    <span style="font-size:11pt;font-family:Arial;color:#000000;background-color:transparent;font-weight:400;font-style:normal;font-variant:normal;text-decoration:none;vertical-align:baseline;white-space:pre-wrap;">After a comfortable evening at the hotel, proceed to the Singapore Night Safari, the world's first nocturnal wildlife park.</span>
  </p>
  <p dir="ltr" style="line-height:1.38;margin-top:0pt;margin-bottom:0pt;margin-left:72pt;">
    <span style="font-size:11pt;font-family:Arial;color:#000000;background-color:transparent;font-weight:700;text-decoration:none;white-space:pre-wrap;">Safari Adventure Tram Ride</span>
  </p>
  <p dir="ltr" style="line-height:1.38;margin-top:0pt;margin-bottom:0pt;margin-left:72pt;">
    <span style="font-size:11pt;font-family:Arial;color:rgb(230,0,0);background-color:transparent;font-weight:700;font-style:italic;text-decoration:underline solid rgb(230,0,0);vertical-align:baseline;white-space:pre-wrap;">Spot a variety of fascinating wildlife</span>, including animals that are most active after sunset.
  </p>
  <h2 dir="ltr" style="line-height:1.38;margin-top:18pt;margin-bottom:6pt;">
    <span style="font-size:16pt;font-family:Arial;color:#000000;font-weight:700;text-decoration:underline solid rgb(0,0,0);white-space:pre-wrap;">Inclusions</span>
  </h2>
  <ul style="margin-top:0pt;margin-bottom:0pt;padding-inline-start:48px;">
    <li dir="ltr" style="line-height:1.38;margin-top:0pt;margin-bottom:0pt;margin-left:72pt;padding-left:0pt;">
      <span style="font-size:11pt;font-family:Arial;color:#000000;font-weight:400;white-space:pre-wrap;">Night Safari Entry Ticket</span>
    </li>
    <li dir="ltr" style="line-height:1.38;margin-top:0pt;margin-bottom:0pt;margin-left:72pt;">
      <span style="font-size:11pt;font-family:Arial;color:#000000;font-weight:400;white-space:pre-wrap;">Safari Adventure Tram Ride</span>
    </li>
    <li dir="ltr" style="line-height:1.38;margin-top:0pt;margin-bottom:0pt;margin-left:72pt;">
      <span style="font-size:11pt;font-family:Arial;color:#000000;font-weight:400;white-space:pre-wrap;">Return Hotel Transfers</span>
    </li>
  </ul>
  <p dir="ltr" style="line-height:1.38;margin-top:0pt;margin-bottom:0pt;">
    <a href="https://example.com/safari" style="text-decoration:none;"><span style="font-size:11pt;font-family:Arial;color:#1155cc;text-decoration:none;white-space:pre-wrap;">Book online</span></a>
  </p>
  <p dir="ltr" style="line-height:1.38;margin-top:0pt;margin-bottom:0pt;"><span style="font-size:11pt;font-family:Arial;color:#000000;white-space:pre-wrap;"> </span></p>
  <br class="Apple-interchange-newline">
</b>
`;

function parse(html: string): HTMLElement {
  const el = document.createElement('div');
  el.innerHTML = html;
  return el;
}

const normalized = normalizePastedHtml(GOOGLE_DOCS_HTML);
const root = parse(normalized);

describe('normalizePastedHtml — Google Docs paste', () => {
  it('A. removes unwanted indentation (margin / padding / text-indent / wrappers)', () => {
    expect(normalized).not.toMatch(/margin/i);
    expect(normalized).not.toMatch(/padding/i);
    expect(normalized).not.toMatch(/text-indent/i);
    expect(normalized).not.toContain('docs-internal-guid');
    for (const el of Array.from(root.querySelectorAll('[style]'))) {
      expect(el.getAttribute('style')).not.toMatch(/margin|padding|text-indent/i);
    }
  });

  it('B. keeps paragraphs separate and normalizes block spacing', () => {
    const paragraphs = Array.from(root.querySelectorAll('p'));
    expect(paragraphs.length).toBeGreaterThanOrEqual(3);
    const texts = paragraphs.map((p) => p.textContent?.trim() ?? '');
    expect(texts[0]).toContain('After a comfortable evening');
    expect(texts[1]).toContain('Safari Adventure Tram Ride');
    // No blank paragraph left behind from Google's empty <p> spacer.
    expect(texts.some((text) => text === '')).toBe(false);
  });

  it('C. drops foreign font-family / size / line-height / mso styles', () => {
    expect(normalized).not.toContain('font-family');
    expect(normalized).not.toContain('font-size');
    expect(normalized).not.toContain('line-height');
    expect(normalized).not.toMatch(/mso-/i);
    expect(normalized).not.toContain('vertical-align');
    expect(normalized).not.toContain('white-space');
  });

  it('D. strips margin and padding declarations', () => {
    expect(normalized).not.toMatch(/margin-(?:top|bottom|left|right|inline-start)/i);
    expect(normalized).not.toMatch(/padding-(?:left|right|inline-start)/i);
  });

  it('E. strips text-indent', () => {
    expect(normalized).not.toContain('text-indent');
  });

  it('F. preserves bold (<strong>) without bolding the whole paste', () => {
    const bold = Array.from(root.querySelectorAll('strong'));
    const boldTexts = bold.map((el) => el.textContent?.trim());
    expect(boldTexts).toContain('Safari Adventure Tram Ride');
    expect(boldTexts).toContain('Spot a variety of fascinating wildlife');
    // The docs-internal-guid <b style="font-weight:normal"> wrapper must not
    // turn the surrounding body copy bold.
    const firstParagraph = root.querySelector('p');
    expect(firstParagraph?.querySelector('strong')).toBeNull();
    expect(normalized).not.toMatch(/<b[\s>]/i);
  });

  it('G. preserves italic (<em>)', () => {
    const italic = Array.from(root.querySelectorAll('em')).map((el) => el.textContent?.trim());
    expect(italic).toContain('Spot a variety of fascinating wildlife');
  });

  it('H. preserves underline (<u>)', () => {
    const underlined = Array.from(root.querySelectorAll('u')).map((el) =>
      el.textContent?.trim(),
    );
    expect(underlined).toContain('Spot a variety of fascinating wildlife');
    expect(underlined).toContain('Inclusions');
  });

  it('I. preserves intentional colour and drops default black', () => {
    const colored = root.querySelector('span[style*="color"]');
    expect(colored).not.toBeNull();
    expect(colored?.getAttribute('style')).toMatch(/rgb\(230,\s*0,\s*0\)/);
    expect(normalized).not.toContain('#000000');
    expect(normalized).not.toMatch(/rgb\(0,\s*0,\s*0\)/);
  });

  it('I2. drops near-white text colours that would be invisible on white surfaces', () => {
    // Representative fixture for white-on-dark source content (e.g. a
    // dark-mode document): without normalization the white survives into the
    // stored HTML and renders white-on-white in the editor. This does not
    // claim to be any actual stored record.
    const root = parse(
      normalizePastedHtml(
        '<p><span style="color:#ffffff">white hex</span> ' +
          '<span style="color:#fff">white short hex</span> ' +
          '<span style="color:rgb(255, 255, 255)">white rgb</span> ' +
          '<span style="color:white">white keyword</span> ' +
          '<span style="color:#FFFAFA">snow</span> ' +
          '<span style="color:rgb(230,0,0)">kept red</span></p>',
      ),
    );
    expect(root.textContent).toContain('white hex');
    expect(root.textContent).toContain('snow');
    // No color declaration survives except the intentional red.
    const styled = Array.from(root.querySelectorAll('span[style]')).map((el) =>
      el.getAttribute('style'),
    );
    expect(styled).toHaveLength(1);
    expect(styled[0]).toMatch(/rgb\(230,\s*0,\s*0\)/);
  });

  it('I3. drops near-white colours from font tags and backgrounds too', () => {
    const root = parse(
      normalizePastedHtml(
        '<p><font color="white">font white</font> ' +
          '<span style="background-color:#ffffff">white highlight</span> ' +
          '<span style="color:#000000">black dropped</span></p>',
      ),
    );
    expect(root.textContent).toContain('font white');
    expect(root.textContent).toContain('white highlight');
    // No style declaration retains a near-white colour (text itself may
    // mention the word "white", so inspect attributes, not markup text).
    const styles = Array.from(root.querySelectorAll('[style]')).map((el) =>
      el.getAttribute('style'),
    );
    expect(styles).toHaveLength(0);
  });

  it('J. preserves unordered lists and their items', () => {
    const list = root.querySelector('ul');
    expect(list).not.toBeNull();
    const items = Array.from(list?.querySelectorAll('li') ?? []).map((li) =>
      li.textContent?.trim(),
    );
    expect(items).toEqual([
      'Night Safari Entry Ticket',
      'Safari Adventure Tram Ride',
      'Return Hotel Transfers',
    ]);
  });

  it('J2. preserves ordered and nested lists without list indentation styles', () => {
    const list = parse(
      normalizePastedHtml(
        '<ol style="margin-left:36pt"><li>First</li><li>Second<ul style="padding-left:20px"><li>Nested</li></ul></li></ol>',
      ),
    );
    const ordered = list.querySelector('ol');
    expect(ordered).not.toBeNull();
    expect(Array.from(ordered?.children ?? []).map((child) => child.tagName)).toEqual([
      'LI',
      'LI',
    ]);
    expect(ordered?.querySelector('ul li')?.textContent).toBe('Nested');
    expect(list.innerHTML).not.toMatch(/margin|padding/i);
  });

  it('K. preserves safe hyperlinks and removes unsafe schemes', () => {
    expect(root.querySelector('a')?.getAttribute('href')).toBe('https://example.com/safari');

    const unsafe = parse(
      normalizePastedHtml('<p><a href="javascript:alert(1)">click</a> and <a href="/local">local</a></p>'),
    );
    const anchors = Array.from(unsafe.querySelectorAll('a'));
    expect(anchors[0]?.hasAttribute('href')).toBe(false);
    expect(anchors[0]?.textContent).toBe('click');
    expect(anchors[1]?.getAttribute('href')).toBe('/local');
  });

  it('L. keeps the normal paragraph structure and headings', () => {
    expect(root.querySelector('h2')?.textContent?.trim()).toBe('Inclusions');
    expect(root.querySelectorAll('p').length).toBeGreaterThanOrEqual(4);
    // Google's trailing clipboard <br> is removed.
    expect(normalized.endsWith('<br>')).toBe(false);
  });

  it('preserves supported alignment', () => {
    const aligned = parse(
      normalizePastedHtml('<p style="text-align:center;margin:0">Centered</p>'),
    );
    expect(aligned.querySelector('p')?.getAttribute('style')).toBe('text-align: center');
  });

  it('drops scripts, styles and event handlers', () => {
    const safe = parse(
      normalizePastedHtml(
        '<style>p{color:red}</style><script>alert(1)</script><p onclick="alert(2)">Safe</p>',
      ),
    );
    expect(safe.querySelector('script')).toBeNull();
    expect(safe.querySelector('style')).toBeNull();
    expect(safe.querySelector('p')?.hasAttribute('onclick')).toBe(false);
    expect(safe.textContent).toBe('Safe');
  });

  it('flattens table/layout wrappers without merging cell paragraphs', () => {
    const table = parse(
      normalizePastedHtml(
        '<table><tbody><tr><td style="padding-left:40px">Cell one</td><td>Cell two</td></tr></tbody></table>',
      ),
    );
    expect(table.querySelector('table')).toBeNull();
    const texts = Array.from(table.querySelectorAll('p')).map((p) => p.textContent?.trim());
    expect(texts).toEqual(['Cell one', 'Cell two']);
  });

  it('normalizes plain text pastes that arrive without markup', () => {
    expect(normalizePastedHtml('')).toBe('');
    expect(normalizePastedHtml('   ')).toBe('');
  });
});

/**
 * Regression: the previous normalizer turned normal Google Docs paragraphs into
 * list items, so the editor and weblink showed bullets that were never in the
 * source document. Normal paragraphs must stay `<p>`; only real lists keep
 * `<ul>`/`<ol>` and `<li>`.
 */
describe('normalizePastedHtml — paragraphs never become bullets', () => {
  const paragraphs = (count: number) =>
    Array.from(
      { length: count },
      (_, index) =>
        `<p dir="ltr" style="line-height:1.38;margin-top:0pt;margin-bottom:0pt;margin-left:72pt;"><span style="font-size:11pt;font-family:Arial;color:#000000;font-weight:400;white-space:pre-wrap;">Paragraph ${index + 1}</span></p>`,
    ).join('');

  it('A/B/C. keeps multiple Google Docs paragraphs as separate <p> with no <ul>/<li>', () => {
    const out = normalizePastedHtml(
      `<meta charset="utf-8"><b id="docs-internal-guid-x" style="font-weight:normal;">${paragraphs(4)}</b>`,
    );
    const root = parse(out);
    expect(Array.from(root.querySelectorAll('p')).map((p) => p.textContent)).toEqual([
      'Paragraph 1',
      'Paragraph 2',
      'Paragraph 3',
      'Paragraph 4',
    ]);
    expect(root.querySelector('ul')).toBeNull();
    expect(root.querySelector('ol')).toBeNull();
    expect(root.querySelector('li')).toBeNull();
    expect(out).not.toMatch(/margin|font-family|font-size|line-height/i);
  });

  it('flattens a layout <ul>/<ol> wrapper that only contains paragraphs', () => {
    const out = normalizePastedHtml(
      '<ul style="margin-left:36pt;padding-inline-start:48px"><p>First</p><p>Second</p></ul>',
    );
    const root = parse(out);
    expect(Array.from(root.querySelectorAll('p')).map((p) => p.textContent)).toEqual([
      'First',
      'Second',
    ]);
    expect(root.querySelector('ul')).toBeNull();
    expect(root.querySelector('li')).toBeNull();
  });

  it('flattens marker-suppressed lists (indentation) into paragraphs', () => {
    const out = normalizePastedHtml(
      '<ul><li style="list-style-type:none">One</li><li style="list-style-type:none">Two</li></ul>',
    );
    const root = parse(out);
    expect(Array.from(root.querySelectorAll('p')).map((p) => p.textContent)).toEqual([
      'One',
      'Two',
    ]);
    expect(root.querySelector('ul')).toBeNull();
    expect(root.querySelector('li')).toBeNull();
  });

  it('renders a bare list item as a paragraph instead of inventing a bullet', () => {
    const root = parse(normalizePastedHtml('<li style="margin-left:36pt">Loose line</li>'));
    expect(root.querySelectorAll('p')).toHaveLength(1);
    expect(root.querySelector('ul')).toBeNull();
    expect(root.querySelector('li')).toBeNull();
  });

  it('D. preserves a real unordered list', () => {
    const root = parse(
      normalizePastedHtml(
        '<ul style="padding-inline-start:48px"><li style="list-style-type:disc">Item 1</li><li style="list-style-type:disc">Item 2</li><li style="list-style-type:disc">Item 3</li></ul>',
      ),
    );
    const list = root.querySelector('ul');
    expect(list).not.toBeNull();
    expect(Array.from(list?.querySelectorAll('li') ?? []).map((li) => li.textContent)).toEqual([
      'Item 1',
      'Item 2',
      'Item 3',
    ]);
  });

  it('E. preserves a real ordered list', () => {
    const root = parse(
      normalizePastedHtml(
        '<ol style="padding-inline-start:48px"><li style="list-style-type:decimal">First</li><li style="list-style-type:decimal">Second</li></ol>',
      ),
    );
    const list = root.querySelector('ol');
    expect(list).not.toBeNull();
    expect(Array.from(list?.querySelectorAll('li') ?? []).map((li) => li.textContent)).toEqual([
      'First',
      'Second',
    ]);
  });

  it('F. keeps paragraph boundaries without merging them', () => {
    const root = parse(normalizePastedHtml('' + paragraphs(3)));
    const texts = Array.from(root.querySelectorAll('p')).map((p) => p.textContent);
    expect(texts).toHaveLength(3);
    expect(texts.join(' ')).not.toContain('Paragraph 1Paragraph 2');
  });

  it('nests a Google Docs sibling sub-list under its item', () => {
    const root = parse(
      normalizePastedHtml(
        '<ul><li style="list-style-type:disc">Top</li><ul><li style="list-style-type:circle">Nested</li></ul></ul>',
      ),
    );
    expect(root.querySelector('ul > li > ul > li')?.textContent).toBe('Nested');
  });
});

/**
 * Exact content from the reported screenshots: normal paragraphs plus a real
 * "Inclusions" list. Only the actual list items may become `<li>`.
 */
describe('normalizePastedHtml — screenshot content', () => {
  const SCREENSHOT_HTML = `<meta charset="utf-8"><b style="font-weight:normal;" id="docs-internal-guid-shot">
    <p dir="ltr" style="line-height:1.38;margin-top:0pt;margin-bottom:0pt;margin-left:72pt;padding-left:36pt;text-indent:18pt;"><span style="font-size:11pt;font-family:Arial,sans-serif;color:#000000;background-color:transparent;font-weight:400;white-space:pre-wrap;">After a </span><span style="font-size:11pt;font-family:Arial,sans-serif;color:#000000;font-weight:700;white-space:pre-wrap;">comfortable evening</span><span style="font-size:11pt;font-family:Arial,sans-serif;color:#000000;white-space:pre-wrap;"> at the hotel, proceed to the Singapore Night Safari, the world's first nocturnal wildlife park.</span></p>
    <p dir="ltr" style="line-height:1.38;margin-left:72pt;"><span style="font-size:11pt;font-family:Arial;color:#000000;white-space:pre-wrap;">Enter the park and explore its unique wildlife zones, specially designed to recreate natural habitats for </span><span style="font-size:11pt;font-family:Arial;color:#000000;font-style:italic;white-space:pre-wrap;">nocturnal animals</span><span style="font-size:11pt;font-family:Arial;color:#000000;white-space:pre-wrap;">.</span></p>
    <p dir="ltr" style="line-height:1.38;margin-left:72pt;"><span style="font-size:11pt;font-family:Arial;color:#000000;white-space:pre-wrap;">Enjoy the </span><span style="font-size:11pt;font-family:Arial;color:#000000;font-weight:700;white-space:pre-wrap;">Safari Adventure Tram Ride</span><span style="font-size:11pt;font-family:Arial;color:#000000;white-space:pre-wrap;">, a guided journey through different zones of the park.</span></p>
    <p dir="ltr" style="line-height:1.38;margin-left:72pt;"><span style="font-size:11pt;font-family:Arial;color:rgb(230,0,0);font-weight:700;white-space:pre-wrap;">Spot a variety of fascinating wildlife</span><span style="font-size:11pt;font-family:Arial;color:#000000;white-space:pre-wrap;">, including animals that are most active after sunset.</span></p>
    <p dir="ltr" style="line-height:1.38;margin-left:72pt;"><span style="font-size:11pt;font-family:Arial;color:#000000;white-space:pre-wrap;">Experience the unique atmosphere of the park as you explore its beautifully illuminated surroundings and naturalistic habitats.</span></p>
    <p dir="ltr" style="line-height:1.38;margin-left:72pt;"><span style="font-size:11pt;font-family:Arial;color:rgb(255,0,255);white-space:pre-wrap;">Enjoy the opportunity to</span><span style="font-size:11pt;font-family:Arial;color:#000000;white-space:pre-wrap;"> observe nocturnal wildlife in a safe and immersive setting.</span></p>
    <p dir="ltr" style="line-height:1.38;margin-left:72pt;"><span style="font-size:11pt;font-family:Arial;color:#000000;white-space:pre-wrap;">After completing the Night Safari experience, board the vehicle for your return transfer to the hotel.</span></p>
    <h2 dir="ltr" style="line-height:1.38;margin-top:18pt;margin-bottom:6pt;"><span style="font-size:16pt;font-family:Arial;color:#000000;font-weight:700;text-decoration:underline solid rgb(0,0,0);white-space:pre-wrap;">Inclusions</span></h2>
    <ul style="margin-top:0;margin-bottom:0;padding-inline-start:48px;"><li dir="ltr" style="list-style-type:disc;font-size:11pt;font-family:Arial;color:#000000;font-weight:400;"><p dir="ltr" style="line-height:1.38;margin-top:0pt;margin-bottom:0pt;" role="presentation"><span style="font-size:11pt;font-family:Arial;color:#000000;white-space:pre-wrap;">Night Safari Entry Ticket</span></p></li><li dir="ltr" style="list-style-type:disc;font-size:11pt;font-family:Arial;color:#000000;font-weight:400;"><p dir="ltr" style="line-height:1.38;margin-top:0pt;margin-bottom:0pt;" role="presentation"><span style="font-size:11pt;font-family:Arial;color:#000000;white-space:pre-wrap;">Safari Adventure Tram Ride</span></p></li><li dir="ltr" style="list-style-type:disc;font-size:11pt;font-family:Arial;color:#000000;font-weight:400;"><p dir="ltr" style="line-height:1.38;margin-top:0pt;margin-bottom:0pt;" role="presentation"><span style="font-size:11pt;font-family:Arial;color:#000000;white-space:pre-wrap;">Return Hotel Transfers</span></p></li></ul>
    <br class="Apple-interchange-newline"></b>`;

  const root = parse(normalizePastedHtml(SCREENSHOT_HTML));

  it('keeps the seven source paragraphs as <p> (no bullets)', () => {
    const paragraphs = Array.from(root.querySelectorAll('p'));
    expect(paragraphs).toHaveLength(7);
    expect(paragraphs[0]?.textContent).toContain('After a comfortable evening at the hotel');
    expect(paragraphs[6]?.textContent).toContain('After completing the Night Safari experience');
    // The only list in the document is the real Inclusions list.
    expect(root.querySelectorAll('ul')).toHaveLength(1);
    expect(root.querySelectorAll('ol')).toHaveLength(0);
    expect(root.querySelectorAll('li')).toHaveLength(3);
  });

  it('preserves bold, italic, colour, the heading and the real list', () => {
    expect(
      Array.from(root.querySelectorAll('strong')).map((el) => el.textContent),
    ).toContain('Safari Adventure Tram Ride');
    expect(root.querySelector('em')?.textContent).toBe('nocturnal animals');
    expect(root.querySelector('span[style*="color"]')?.getAttribute('style')).toMatch(
      /rgb\(230,\s*0,\s*0\)/,
    );
    expect(root.textContent).toContain('Enjoy the opportunity to');
    expect(root.querySelector('h2')?.textContent).toBe('Inclusions');
    expect(root.querySelector('h2 u')?.textContent).toBe('Inclusions');
    expect(
      Array.from(root.querySelector('ul')?.querySelectorAll('li') ?? []).map((li) =>
        li.textContent?.trim(),
      ),
    ).toEqual(['Night Safari Entry Ticket', 'Safari Adventure Tram Ride', 'Return Hotel Transfers']);
  });

  it('removes Google Docs layout and stray trailing blocks', () => {
    const html = normalizePastedHtml(SCREENSHOT_HTML);
    expect(html).not.toMatch(/margin|padding|text-indent|font-family|font-size|line-height/i);
    expect(html).not.toContain('docs-internal-guid');
    expect(html).not.toContain('Apple-interchange-newline');
    expect(html.endsWith('<br>')).toBe(false);
  });
});

/**
 * The CRM — not the pasted document — owns paragraph rhythm. Consecutive
 * paragraphs have zero margin (so Enter never adds a gap), while the source's
 * *intentional* blank lines survive as semantic blank paragraphs. Blank lines
 * are only honoured when the source explicitly encodes one (a lone <br> or a
 * whitespace/nbsp run); truly empty wrappers and Google layout margins are
 * dropped rather than converted into spacing.
 */
describe('normalizePastedHtml — blank lines and paragraph spacing', () => {
  it('preserves an intentional blank paragraph', () => {
    const root = parse(
      normalizePastedHtml('<p>First paragraph</p><p><br></p><p>Second paragraph</p>'),
    );
    const paragraphs = Array.from(root.querySelectorAll('p'));
    expect(paragraphs).toHaveLength(3);
    expect(paragraphs[1]?.textContent?.trim()).toBe('');
    expect(paragraphs[1]?.querySelector('br')).not.toBeNull();
    expect(root.querySelector('ul')).toBeNull();
    expect(root.querySelector('li')).toBeNull();
  });

  it('preserves a whitespace/nbsp blank paragraph', () => {
    const root = parse(
      normalizePastedHtml(
        '<p>First</p><p><span style="font-family:Arial">&#160;</span></p><p>Second</p>',
      ),
    );
    expect(root.querySelectorAll('p')).toHaveLength(3);
  });

  it('preserves a truly empty paragraph as an intentional blank line', () => {
    const root = parse(normalizePastedHtml('<p>First</p><p></p><p>Second</p>'));
    const paragraphs = Array.from(root.querySelectorAll('p'));
    expect(paragraphs.map((p) => p.textContent)).toEqual(['First', '', 'Second']);
    // Materialised as a visible blank line (br), never as a bullet.
    expect(paragraphs[1]?.querySelector('br')).not.toBeNull();
    expect(root.querySelector('ul')).toBeNull();
    expect(root.querySelector('li')).toBeNull();
  });

  it('trims leading and trailing blank paragraphs as clipboard junk', () => {
    const root = parse(normalizePastedHtml('<p><br></p><p>Only line</p><p><br></p>'));
    expect(root.querySelectorAll('p')).toHaveLength(1);
    expect(root.querySelector('p')?.textContent).toBe('Only line');
  });

  it('translates meaningful Google Docs vertical margins into a CRM blank line', () => {
    const out = normalizePastedHtml(
      '<p style="margin-top:0pt;margin-bottom:11pt;line-height:1.38">First</p><p style="margin-top:0pt;margin-bottom:0pt">Second</p>',
    );
    const root = parse(out);
    // Spacing is preserved as a CRM-native blank paragraph, not as raw margins.
    expect(Array.from(root.querySelectorAll('p')).map((p) => p.textContent)).toEqual([
      'First',
      '',
      'Second',
    ]);
    expect(out).not.toMatch(/margin/i);
    expect(out).not.toMatch(/data-space/i);
  });

  it('does not add spacing to paragraphs the source left tight (0pt margins)', () => {
    const out = normalizePastedHtml(
      '<p style="margin-top:0pt;margin-bottom:0pt">Line 1</p><p style="margin-top:0pt;margin-bottom:0pt">Line 2</p><p>Line 3</p>',
    );
    expect(out).toBe('<p>Line 1</p><p>Line 2</p><p>Line 3</p>');
  });

  it('honours tight spacing from either a top or bottom margin, once', () => {
    expect(
      normalizePastedHtml('<p style="margin-bottom:6pt">A</p><p>B</p>').replace(/\s+/g, ''),
    ).toBe('<p>A</p><p><br></p><p>B</p>');
    expect(
      normalizePastedHtml('<p>A</p><p style="margin-top:6pt">B</p>').replace(/\s+/g, ''),
    ).toBe('<p>A</p><p><br></p><p>B</p>');
    // Both edges present on adjacent paragraphs must not double the gap.
    expect(
      normalizePastedHtml(
        '<p style="margin-bottom:8pt">A</p><p style="margin-top:8pt">B</p>',
      ).replace(/\s+/g, ''),
    ).toBe('<p>A</p><p><br></p><p>B</p>');
  });

  it('reads margin shorthand and ignores tiny/zero values', () => {
    expect(
      normalizePastedHtml('<p style="margin:0 0 11pt 0">A</p><p>B</p>').replace(/\s+/g, ''),
    ).toBe('<p>A</p><p><br></p><p>B</p>');
    expect(normalizePastedHtml('<p style="margin:1pt 0 1pt 0">A</p><p>B</p>')).toBe(
      '<p>A</p><p>B</p>',
    );
    expect(normalizePastedHtml('<p style="margin:0pt">A</p><p style="margin:0">B</p>')).toBe(
      '<p>A</p><p>B</p>',
    );
  });

  it('does not double a gap when a blank paragraph already exists', () => {
    expect(
      normalizePastedHtml(
        '<p style="margin-bottom:11pt">A</p><p><br></p><p style="margin-top:11pt">B</p>',
      ).replace(/\s+/g, ''),
    ).toBe('<p>A</p><p><br></p><p>B</p>');
  });

  it('does not space around headings or lists', () => {
    const out = normalizePastedHtml(
      '<p style="margin-bottom:18pt">Body</p><h2 style="margin-top:18pt;margin-bottom:6pt">Title</h2><ul style="margin-top:0"><li>Item</li></ul>',
    );
    const root = parse(out);
    expect(Array.from(root.querySelectorAll('p')).map((p) => p.textContent)).toEqual(['Body']);
    expect(root.querySelector('h2')?.textContent).toBe('Title');
    expect(root.querySelectorAll('ul li')).toHaveLength(1);
    expect(out).not.toMatch(/data-space/i);
  });

  it('drops empty list items without inventing bullets', () => {
    const root = parse(
      normalizePastedHtml('<ul><li></li><li style="list-style-type:disc">Real item</li></ul>'),
    );
    const items = Array.from(root.querySelectorAll('li'));
    expect(items).toHaveLength(1);
    expect(items[0]?.textContent).toBe('Real item');
  });

  it('preserves Google Docs indented-paragraph lists and their blank-line items', () => {
    // Real Google Docs clipboard: body paragraphs are `<li list-style-type:none>`
    // inside a `<ul>`, and a blank line between them is `<li><br /></li>`.
    const para = (text: string) =>
      `<li dir="ltr" style="list-style-type:none;font-size:10.5pt;font-family:Roboto,sans-serif"><p dir="ltr" style="line-height:1.38;margin-top:0pt;margin-bottom:0pt" role="presentation"><span>${text}</span></p></li>`;
    const blank = `<li dir="ltr" style="list-style-type:none;font-size:10.5pt"><br /></li>`;
    const html = `<meta charset="utf-8"><b style="font-weight:normal" id="docs-internal-guid-x"><ul style="margin-top:0;margin-bottom:0;padding-inline-start:48px">${para('First')}${blank}${para('Second')}${blank}${para('Third')}</ul></b>`;

    const out = normalizePastedHtml(html);
    const root = parse(out);
    expect(Array.from(root.querySelectorAll('p')).map((p) => p.textContent)).toEqual([
      'First',
      '',
      'Second',
      '',
      'Third',
    ]);
    // No bullets / list structure invented from the indentation wrapper.
    expect(root.querySelectorAll('ul')).toHaveLength(0);
    expect(root.querySelectorAll('ol')).toHaveLength(0);
    expect(root.querySelectorAll('li')).toHaveLength(0);
    expect(out).not.toMatch(/list-style|margin/i);
  });

  it('keeps a soft line break inside a paragraph', () => {
    const root = parse(normalizePastedHtml('<p>First line<br>Second line</p>'));
    expect(root.querySelectorAll('p')).toHaveLength(1);
    expect(root.querySelector('p br')).not.toBeNull();
  });

  it('preserves strike, underline, bold, italic, colour and links together', () => {
    const root = parse(
      normalizePastedHtml(
        '<p><span style="text-decoration:line-through">gone</span> <u>under</u> <strong>bold</strong> <em>italic</em> <span style="color:rgb(230,0,0)">red</span> <a href="https://example.com">link</a></p>',
      ),
    );
    expect(root.querySelector('s')?.textContent).toBe('gone');
    expect(root.querySelector('u')?.textContent).toBe('under');
    expect(root.querySelector('strong')?.textContent).toBe('bold');
    expect(root.querySelector('em')?.textContent).toBe('italic');
    expect(root.querySelector('span[style*="color"]')?.textContent).toBe('red');
    expect(root.querySelector('a')?.getAttribute('href')).toBe('https://example.com');
  });
});

/**
 * The CRM — not the pasted document — owns paragraph rhythm. Consecutive
 * paragraphs must have zero vertical margin so that pressing Enter never adds a
 * blank-line gap (the previous `p + p { margin-top: 0.75rem }` regression).
 */
describe('rich-text spacing contract', () => {
  const candidates = [
    resolve(process.cwd(), 'src/index.css'),
    resolve(process.cwd(), 'apps/web/src/index.css'),
  ];
  const cssPath = candidates.find((candidate) => existsSync(candidate)) ?? candidates[0]!;
  const css = readFileSync(cssPath, 'utf8');

  it('does not add artificial margin between consecutive paragraphs', () => {
    expect(css).not.toMatch(/\.rich-text-content\s+p\s*\+\s*p/);
    expect(css).not.toMatch(/\.rich-text-content[^{]*p\s*\{[^}]*margin-top:\s*[1-9]/);
  });

  it('pins rich-text paragraph margins to zero', () => {
    const rule = css.match(/\.rich-text-content p\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(rule).toMatch(/margin-top:\s*0/);
    expect(rule).toMatch(/margin-bottom:\s*0/);
  });

  it('never hides spacing with negative margins or transforms', () => {
    expect(css).not.toMatch(/\.rich-text-content[^}]*margin[^:]*:\s*-/);
  });
});

/**
 * Read-only renders collapse `<p></p>` to zero height, which is how the
 * editor's intentional blank lines / paragraph spacing disappeared in the
 * Master Detail view. `ensureBlankParagraphs` restores them at the render
 * layer without adding any margin between ordinary paragraphs.
 */
describe('ensureBlankParagraphs — detail/weblink rendering', () => {
  it('materialises an empty paragraph as a visible blank line', () => {
    const html = ensureBlankParagraphs('<p>First</p><p></p><p>Second</p>');
    const root = parse(html);
    const paragraphs = Array.from(root.querySelectorAll('p'));
    expect(paragraphs).toHaveLength(3);
    expect(paragraphs[1]?.querySelector('br')).not.toBeNull();
    expect(paragraphs[1]?.textContent).toBe('');
  });

  it('leaves paragraphs that already render alone', () => {
    expect(ensureBlankParagraphs('<p>First</p><p><br></p><p>Second</p>')).toBe(
      '<p>First</p><p><br></p><p>Second</p>',
    );
    expect(ensureBlankParagraphs('<p>One</p><p>Two</p>')).toBe('<p>One</p><p>Two</p>');
  });

  it('never invents bullets while restoring blank lines', () => {
    const root = parse(ensureBlankParagraphs('<p>First</p><p></p><p>Second</p>'));
    expect(root.querySelector('ul')).toBeNull();
    expect(root.querySelector('li')).toBeNull();
  });

  it('canonicalises legacy empty paragraphs, including empty inline wrappers', () => {
    for (const legacy of ['<p></p>', '<p><span></span></p>', '<p>&nbsp;</p>']) {
      const html = ensureBlankParagraphs(`<p>First</p>${legacy}<p>Second</p>`);
      expect(html).toBe('<p>First</p><p><br></p><p>Second</p>');
    }
  });

  it('trims leading/trailing blanks only when asked, keeping interior blanks', () => {
    const html = '<p><br></p><p>First</p><p><br></p><p>Second</p><p></p>';
    expect(ensureBlankParagraphs(html, { trimEdges: true })).toBe(
      '<p>First</p><p><br></p><p>Second</p>',
    );
    // Without trimming the edges are preserved (used while editing).
    expect(ensureBlankParagraphs(html)).toBe(
      '<p><br></p><p>First</p><p><br></p><p>Second</p><p><br></p>',
    );
  });

  it('preserves formatting, headings and real lists while materialising blanks', () => {
    const root = parse(
      ensureBlankParagraphs(
        '<p><strong>Bold</strong> <em>italic</em> <u>u</u> <s>s</s> <span style="color:#ff0000">red</span> <a href="https://example.com">link</a></p><p></p><h2>Heading</h2><ul><li>Item</li></ul><ol><li>First</li></ol>',
      ),
    );
    expect(root.querySelector('strong')?.textContent).toBe('Bold');
    expect(root.querySelector('em')?.textContent).toBe('italic');
    expect(root.querySelector('u')?.textContent).toBe('u');
    expect(root.querySelector('s')?.textContent).toBe('s');
    expect(root.querySelector('span[style*="color"]')?.textContent).toBe('red');
    expect(root.querySelector('a')?.getAttribute('href')).toBe('https://example.com');
    expect(root.querySelector('h2')?.textContent).toBe('Heading');
    expect(root.querySelectorAll('ul > li')).toHaveLength(1);
    expect(root.querySelectorAll('ol > li')).toHaveLength(1);
    expect(root.querySelectorAll('p')[1]?.querySelector('br')).not.toBeNull();
  });
});

/**
 * Regression: legacy/imported policy rich text can store bare `<li>` siblings
 * with no `<ul>`/`<ol>` container. Without a container the items get no list
 * padding, so their `outside` markers are clipped by the editors'
 * `overflow-hidden` wrapper (plain lines in the builder) while the public
 * weblink still paints the default disc — the reported mismatch. Re-wrapping
 * the orphans restores one real bullet list everywhere.
 */
describe('wrapOrphanListItems — malformed bare list items', () => {
  it('wraps a run of bare <li> siblings into a single <ul>', () => {
    const root = parse(wrapOrphanListItems('<li>One</li><li>Two</li><li>Three</li>'));
    const lists = root.querySelectorAll('ul');
    expect(lists).toHaveLength(1);
    expect(Array.from(lists[0]!.querySelectorAll('li')).map((li) => li.textContent)).toEqual([
      'One',
      'Two',
      'Three',
    ]);
    // No list item is left without a real list container.
    expect(root.querySelectorAll(':scope > li')).toHaveLength(0);
  });

  it('leaves genuine <ul>/<ol> lists exactly as authored', () => {
    const root = parse(
      wrapOrphanListItems('<ul><li>A</li><li>B</li></ul><ol><li>1</li><li>2</li></ol>'),
    );
    expect(root.querySelectorAll('ul')).toHaveLength(1);
    expect(root.querySelectorAll('ol')).toHaveLength(1);
    expect(root.querySelectorAll('ul > li')).toHaveLength(2);
    expect(root.querySelectorAll('ol > li')).toHaveLength(2);
  });

  it('never invents a list for ordinary paragraphs', () => {
    const out = wrapOrphanListItems('<p>First</p><p>Second</p>');
    expect(out).toBe('<p>First</p><p>Second</p>');
    const root = parse(out);
    expect(root.querySelector('ul, ol, li')).toBeNull();
  });

  it('wraps only the orphan items in a mixed document', () => {
    const root = parse(
      wrapOrphanListItems('<p>Intro</p><li>Item A</li><li>Item B</li><p>Outro</p>'),
    );
    expect(Array.from(root.querySelectorAll('p')).map((p) => p.textContent)).toEqual([
      'Intro',
      'Outro',
    ]);
    expect(root.querySelectorAll('ul > li')).toHaveLength(2);
    // The generated <ul> sits between the paragraphs, not around them.
    expect(root.querySelector('ul')?.nextElementSibling?.textContent).toBe('Outro');
  });

  it('is a no-op when there is no list markup', () => {
    expect(wrapOrphanListItems('')).toBe('');
    expect(wrapOrphanListItems('Just plain text')).toBe('Just plain text');
  });
});
