import PDFDocument from 'pdfkit';
import { htmlToLines } from '../quotations/pdf.service.js';
import { drawHeaderLogo, type CompanyBranding } from '../../services/pdf/company-branding.js';

/**
 * Hotel Voucher PDF — premium branded document matching the approved mockup
 * (A4 portrait; deep purple / dark navy / muted gold / pale lavender).
 *
   * Content-driven pagination: sections flow across as many pages as they need
   * (tables and lists break row by row; overflow pages carry a restrained
   * name-only agency header), and content may run to 30pt above the page
 * leaves more than 30 units of bottom whitespace.
 *
 * Rendered exclusively from the voucher's stored snapshot; live Hotel Master
 * rows are never read here so issued vouchers stay historically accurate.
 * Company identity (logo, name, address, phone, email, website) always comes
 * from the passed company branding — never hardcoded. The confirmation card
 * shows the voucher's own confirmation number; the system voucher number,
 * status, and issue date are never rendered. Special Requests, Remarks, hotel
 * stars and weekday names are never rendered.
 */

export interface HotelVoucherPdfPricingRow {
  roomType: string;
  unit: number;
  quantity: number;
  gst: number | null;
  amount: number | null;
  taxablePay: number | null;
  gstService: number | null;
}

export interface HotelVoucherPdfGuestRow {
  guestName: string;
  age: number | null;
  sex: string;
  paxType: string;
}

export interface HotelVoucherPdfStayRoomRow {
  roomType: string;
  rooms: number;
  notes: string | null;
}

export interface HotelVoucherPdfStayMealRow {
  mealPlan: string;
}

export interface HotelVoucherPdfVoucher {
  guestName: string;
  guestPhone: string | null;
  guestEmail: string | null;
  adults: number;
  children: number;
  hotelName: string;
  hotelAddress: string | null;
  hotelCity: string | null;
  hotelPhone: string | null;
  hotelEmail: string | null;
  confirmationNumber: string | null;
  /** Optional external booking reference (free text; never a Booking link). */
  bookingId: string | null;
  /** Optional staff-customized labels; blank falls back to the defaults. */
  confirmationNumberLabel: string | null;
  bookingIdLabel: string | null;
  checkIn: Date;
  checkOut: Date;
  roomTypeName: string | null;
  rooms: number;
  mealPlanName: string | null;
  stayRooms: HotelVoucherPdfStayRoomRow[];
  stayMeals: HotelVoucherPdfStayMealRow[];
  pricing: HotelVoucherPdfPricingRow[];
  guests: HotelVoucherPdfGuestRow[];
  termsSnapshot: string | null;
  /**
   * Package-includes items. There is currently no voucher-owned source field
   * for these, so the service passes null (section omitted) until such a
   * field is approved; the renderer already lays the section out correctly.
   */
  packageIncludes: string[] | null;
}

// Mockup design system (the primary purple is the default theme; a company
// may override it via Settings → Branding → Hotel voucher PDF).
const DEFAULT_PRIMARY = '#3d2352';
const NAVY = '#1f2a5c';
const GOLD = '#bd9436';
const GOLD_LIGHT = '#d9b96a';
const MUTED = '#5b6478';
const LAVENDER = '#efe9f7';
const LAVENDER_DEEP = '#e2d7f0';
const ZEBRA = '#f7f3fc';
const BEIGE = '#f6efdc';
const BEIGE_BORDER = '#e3d3ac';
const CARD_BORDER = '#d9cfee';
const TABLE_GRID = '#cfc2e8';
const WHITE = '#ffffff';

const PAGE_W = 595.28;
const PAGE_H = 841.89;
const MARGIN = 40;
const CONTENT_W = PAGE_W - MARGIN * 2;
// Content may run to 30pt above the page edge; the footer furniture
// (accent rules, band, page number) lives entirely inside that bottom
// 30pt zone, so a full page never leaves more than 30 units of whitespace.
const BOTTOM_LIMIT = PAGE_H - 30;
const PAD = 6;

const MONTHS = [
  'JAN',
  'FEB',
  'MAR',
  'APR',
  'MAY',
  'JUN',
  'JUL',
  'AUG',
  'SEP',
  'OCT',
  'NOV',
  'DEC',
];

export function isValidHexColor(value: unknown): value is string {
  return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value);
}

/** Company override or the built-in purple default (never throws). */
export function resolveVoucherPrimary(value: unknown): string {
  return isValidHexColor(value) ? value.toLowerCase() : DEFAULT_PRIMARY;
}

/**
 * Readable foreground for primary-color surfaces: white on dark themes,
 * dark navy on light themes (e.g. pastel yellow) so section headings never
 * go invisible.
 */
export function voucherPrimaryForeground(primary: string): string {
  const channel = (hex: string): number => {
    const srgb = Number.parseInt(hex, 16) / 255;
    return srgb <= 0.03928 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4;
  };
  const luminance =
    0.2126 * channel(primary.slice(1, 3)) +
    0.7152 * channel(primary.slice(3, 5)) +
    0.0722 * channel(primary.slice(5, 7));
  return luminance > 0.4 ? NAVY : WHITE;
}

export interface VoucherTheme {
  primary: string;
  onPrimary: string;
}

/** Full theme for a voucher render from the company's saved setting. */
export function resolveVoucherTheme(value: unknown): VoucherTheme {
  const primary = resolveVoucherPrimary(value);
  return { primary, onPrimary: voucherPrimaryForeground(primary) };
}

function fmtDate(value: Date): string {
  const month = MONTHS[value.getUTCMonth()] ?? '';
  return `${String(value.getUTCDate()).padStart(2, '0')} ${month} ${value.getUTCFullYear()}`;
}

/** Minimal HTML entity decoding for Terms lines (mirrors the PDF helper). */
function decodeTermsText(value: string): string {
  return value
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/&#(\d+);/g, (_: string, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([\da-f]+);/gi, (_: string, code: string) =>
      String.fromCodePoint(Number.parseInt(code, 16)),
    );
}

/**
 * Terms lines for the PDF. Editor HTML is flattened to plain lines;
 * legacy plain text keeps its exact newline structure (htmlToLines would
 * collapse newlines, so it is only used when markup is present).
 *
 * Real `<ol>` items keep sequential `1.` numbering, `<ul>` items keep their
 * `•` bullet, and ordinary paragraphs stay unnumbered — the renderer never
 * invents numbers (see the `numbered=false` Terms call below).
 */
function voucherTextLines(value: string): string[] {
  if (!value.includes('<')) {
    return value
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
  }
  const lines: string[] = [];
  let current = '';
  let pendingPrefix = '';
  const listStack: Array<{ ordered: boolean; counter: number }> = [];
  const flush = () => {
    const text = `${pendingPrefix}${current}`.replace(/\s+/g, ' ').trim();
    pendingPrefix = '';
    current = '';
    if (text) lines.push(text);
  };
  for (const token of value.match(/<[^>]*>|[^<]+/g) ?? []) {
    if (!token.startsWith('<')) {
      current += decodeTermsText(token).replace(/\s+/g, ' ');
      continue;
    }
    const closing = /^<\s*\//.test(token);
    const tag = token.match(/^<\s*\/?\s*([\w-]+)/)?.[1]?.toLowerCase();
    if (!tag) continue;
    if (tag === 'ol' || tag === 'ul') {
      if (closing) listStack.pop();
      else listStack.push({ ordered: tag === 'ol', counter: 1 });
      continue;
    }
    if (tag === 'li') {
      if (closing) {
        flush();
      } else {
        flush();
        const top = listStack[listStack.length - 1];
        if (top?.ordered) {
          pendingPrefix = `${top.counter}. `;
          top.counter += 1;
        } else {
          // Bare `<li>` or unordered item: bullet, never a number.
          pendingPrefix = '• ';
        }
      }
      continue;
    }
    if (
      tag === 'br' ||
      tag === 'p' ||
      tag === 'div' ||
      tag === 'h1' ||
      tag === 'h2' ||
      tag === 'h3' ||
      tag === 'h4' ||
      tag === 'h5' ||
      tag === 'h6' ||
      tag === 'blockquote' ||
      tag === 'pre' ||
      tag === 'tr'
    ) {
      flush();
    }
    // Inline tags (strong/b/i/em/u/s/a/span/font) carry no line structure.
  }
  flush();
  return lines;
}

/** One package item per row: editor HTML flattens to a single line. */
function voucherPackageLine(value: string): string {
  if (!value.includes('<')) return value;
  return htmlToLines(value).join(' ');
}

export async function renderHotelVoucherPdf(input: {
  company: CompanyBranding;
  voucher: HotelVoucherPdfVoucher;
}): Promise<Buffer> {
  const { company, voucher } = input;
  // Theme: company override or the built-in purple default. PURPLE intentionally
  // keeps its name so every branded surface follows the setting with no layout
  // change; ON_PRIMARY keeps text/icons readable on light themes.
  const theme = resolveVoucherTheme(company.hotelVoucherPrimaryColor);
  const PURPLE = theme.primary;
  const ON_PRIMARY = theme.onPrimary;
  const doc = new PDFDocument({ size: 'A4', margin: 0, bufferPages: true });
  const chunks: Buffer[] = [];
  doc.on('data', (chunk: Buffer) => chunks.push(chunk));
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });

  let y = MARGIN;

  /** Start a fresh page when the next block would cross the bottom limit. */
  const ensure = (height: number) => {
    if (y + height > BOTTOM_LIMIT) {
      nextPage();
    }
  };

  /**
   * Fresh continuation page with the restrained name-only agency header, so
   * overflow pages stay branded without repeating the logo. Must be called
   * only when more content follows on the new page.
   */
  const nextPage = () => {
    doc.addPage();
    y = MARGIN;
    agencyHeader(true);
  };

  const measure = (text: string, width: number, font: string, size: number): number => {
    doc.font(font).fontSize(size);
    return doc.heightOfString(text, { width });
  };

  /** White card with a light lavender border. */
  const card = (top: number, height: number) => {
    doc
      .save()
      .fillColor(WHITE)
      .strokeColor(CARD_BORDER)
      .lineWidth(0.9)
      .roundedRect(MARGIN, top, CONTENT_W, height, 7)
      .fillAndStroke()
      .restore();
  };

  /** Small gold diamond bullet used in front of contact lines. */
  const diamond = (cx: number, cy: number, r = 2.4) => {
    doc.save().translate(cx, cy).rotate(Math.PI / 4).rect(-r, -r, r * 2, r * 2).fillColor(GOLD).fill().restore();
  };

  /** Purple + gold divider rule; returns the y below it. */
  const divider = (top: number): number => {
    doc.save().fillColor(PURPLE).rect(MARGIN, top, CONTENT_W, 2.2).fill().restore();
    doc.save().fillColor(GOLD).rect(MARGIN, top + 4, CONTENT_W, 1).fill().restore();
    return top + 9;
  };

  // -- Tiny vector icons (outline style, single color) --------------------
  const iconBuilding = (x: number, cy: number, s: number, color: string) => {
    const top = cy - s / 2;
    doc.save().strokeColor(color).lineWidth(1.4);
    doc.rect(x, top, s, s).stroke();
    doc.fillColor(color);
    const w = s / 5;
    for (const [wx, wy] of [[1, 1], [3, 1], [1, 3], [3, 3]] as const) {
      doc.rect(x + wx * w - w / 3, top + wy * w - w / 3, (w * 2) / 3, (w * 2) / 3).fill();
    }
    doc.restore();
  };
  const iconPerson = (x: number, cy: number, s: number, color: string) => {
    doc.save().strokeColor(color).fillColor(color).lineWidth(1.4);
    doc.circle(x + s / 2, cy - s * 0.22, s * 0.18).stroke();
    doc
      .moveTo(x + s * 0.12, cy + s * 0.42)
      .quadraticCurveTo(x + s * 0.12, cy + s * 0.02, x + s / 2, cy + s * 0.02)
      .quadraticCurveTo(x + s * 0.88, cy + s * 0.02, x + s * 0.88, cy + s * 0.42)
      .closePath()
      .fill();
    doc.restore();
  };
  const iconPersons = (x: number, cy: number, s: number, color: string) => {
    iconPerson(x, cy, s * 0.72, color);
    iconPerson(x + s * 0.34, cy + s * 0.1, s * 0.56, color);
  };
  const iconCalendar = (x: number, cy: number, s: number, color: string) => {
    const top = cy - s / 2;
    doc.save().strokeColor(color).lineWidth(1.4);
    doc.roundedRect(x, top, s, s, 2).stroke();
    doc.moveTo(x, top + s * 0.32).lineTo(x + s, top + s * 0.32).stroke();
    doc.moveTo(x + s * 0.3, top - 1).lineTo(x + s * 0.3, top + 3).stroke();
    doc.moveTo(x + s * 0.7, top - 1).lineTo(x + s * 0.7, top + 3).stroke();
    doc.restore();
  };
  const iconMoon = (x: number, cy: number, s: number, color: string) => {
    doc.save();
    doc.fillColor(color).circle(x + s / 2, cy, s * 0.36).fill();
    // Cut-out in the card color to form a crescent.
    doc.fillColor(WHITE).circle(x + s * 0.66, cy - s * 0.1, s * 0.3).fill();
    doc.restore();
  };
  const iconCoins = (x: number, cy: number, s: number, color: string) => {
    doc.save().strokeColor(color).lineWidth(1.3);
    for (let i = 0; i < 3; i += 1) {
      doc.ellipse(x + s / 2, cy - s * 0.22 + i * s * 0.22, s * 0.42, s * 0.16).stroke();
    }
    doc.restore();
  };
  const iconDoc = (x: number, cy: number, s: number, color: string) => {
    const top = cy - s / 2;
    doc.save().strokeColor(color).lineWidth(1.4);
    doc.rect(x, top, s * 0.78, s).stroke();
    doc
      .moveTo(x + s * 0.78, top + s * 0.3)
      .lineTo(x + s * 0.48, top + s * 0.3)
      .lineTo(x + s * 0.48, top)
      .stroke();
    doc.fillColor(color);
    for (let i = 0; i < 3; i += 1) {
      doc.rect(x + s * 0.14, top + s * (0.44 + i * 0.16), s * 0.5, 1.1).fill();
    }
    doc.restore();
  };
  const iconList = (x: number, cy: number, s: number, color: string) => {
    doc.save().fillColor(color).strokeColor(color).lineWidth(1.3);
    for (let i = 0; i < 3; i += 1) {
      const ly = cy - s * 0.28 + i * s * 0.28;
      doc.circle(x + s * 0.1, ly, 1.4).fill();
      doc.moveTo(x + s * 0.24, ly).lineTo(x + s * 0.92, ly).stroke();
    }
    doc.restore();
  };
  const iconBed = (x: number, cy: number, s: number, color: string) => {
    doc.save().strokeColor(color).lineWidth(1.5).lineCap('round');
    // Headboard + base frame.
    doc.moveTo(x + s * 0.1, cy - s * 0.34).lineTo(x + s * 0.1, cy + s * 0.34).stroke();
    doc
      .moveTo(x + s * 0.1, cy + s * 0.1)
      .lineTo(x + s * 0.88, cy + s * 0.1)
      .lineTo(x + s * 0.88, cy + s * 0.34)
      .stroke();
    // Pillow + blanket split.
    doc.moveTo(x + s * 0.3, cy + s * 0.1).lineTo(x + s * 0.3, cy - s * 0.08).stroke();
    doc.moveTo(x + s * 0.3, cy - s * 0.08).lineTo(x + s * 0.62, cy - s * 0.08).stroke();
    // Legs.
    doc.moveTo(x + s * 0.24, cy + s * 0.34).lineTo(x + s * 0.24, cy + s * 0.44).stroke();
    doc.moveTo(x + s * 0.76, cy + s * 0.34).lineTo(x + s * 0.76, cy + s * 0.44).stroke();
    doc.restore();
  };
  type SectionIcon = 'building' | 'person' | 'calendar' | 'coins' | 'doc' | 'list' | 'bed' | 'moon';
  const drawIcon = (kind: SectionIcon, x: number, cy: number, s: number, color: string) => {
    if (kind === 'building') iconBuilding(x, cy, s, color);
    else if (kind === 'person') iconPersons(x, cy, s, color);
    else if (kind === 'calendar') iconCalendar(x, cy, s, color);
    else if (kind === 'coins') iconCoins(x, cy, s, color);
    else if (kind === 'doc') iconDoc(x, cy, s, color);
    else if (kind === 'list') iconList(x, cy, s, color);
    else if (kind === 'moon') iconMoon(x, cy, s, color);
    else iconBed(x, cy, s, color);
  };

  /**
   * Deep-primary section bar with a contrast icon, bold label, and a
   * restrained gold underline. Fixed height. `keep` reserves room for the
   * content that must follow the bar so the bar is never stranded alone at
   * the bottom of a page.
   */
  const sectionBar = (title: string, icon: SectionIcon, keep = 0) => {
    const height = 28;
    ensure(height + 10 + keep);
    doc.save().fillColor(PURPLE).roundedRect(MARGIN, y, CONTENT_W, height, 6).fill().restore();
    drawIcon(icon, MARGIN + 12, y + height / 2, 15, ON_PRIMARY);
    doc
      .fillColor(ON_PRIMARY)
      .font('Helvetica-Bold')
      .fontSize(11)
      .text(title, MARGIN + 34, y + 8, { width: CONTENT_W - 46, characterSpacing: 1 });
    doc
      .save()
      .fillColor(GOLD)
      .roundedRect(MARGIN + 8, y + height - 2.6, CONTENT_W - 16, 2, 1)
      .fill()
      .restore();
    y += height + 10;
  };

  interface FieldItem {
    label: string;
    value: string;
    boldValue?: boolean;
  }

  /**
   * Profile block: bold heading row plus two columns inside one card with a
   * faint vertical divider. Measures everything first so the card fits.
   */
  const profileBlock = (heading: string, left: FieldItem[], right: FieldItem[]) => {
    const gap = 24;
    const innerPad = 12;
    const colW = (CONTENT_W - innerPad * 2 - gap) / 2;
    const headingH = measure(heading, CONTENT_W - innerPad * 2, 'Helvetica-Bold', 13.5);
    const blockHeight = (items: FieldItem[]): number =>
      items.reduce((sum, item) => {
        const labelH = measure(item.label, colW, 'Helvetica', 9);
        const valueFont = item.boldValue === false ? 'Helvetica' : 'Helvetica-Bold';
        const valueH = measure(item.value, colW, valueFont, 10.5);
        return sum + labelH + 2 + valueH + 9;
      }, 0);
    const bodyH = Math.max(blockHeight(left), blockHeight(right), 20);
    const totalH = headingH + 8 + bodyH + innerPad * 2;
    ensure(totalH + 4);
    const top = y;
    card(top, totalH);
    let cy = top + innerPad;
    doc.fillColor(NAVY).font('Helvetica-Bold').fontSize(13.5).text(heading, MARGIN + innerPad, cy, {
      width: CONTENT_W - innerPad * 2,
    });
    cy += headingH + 8;
    const dividerX = MARGIN + innerPad + colW + gap / 2;
    if (bodyH > 30) {
      doc
        .save()
        .strokeColor(CARD_BORDER)
        .lineWidth(0.7)
        .moveTo(dividerX, cy)
        .lineTo(dividerX, cy + bodyH)
        .stroke()
        .restore();
    }
    const renderColumn = (items: FieldItem[], x: number) => {
      let iy = cy;
      for (const item of items) {
        const labelH = measure(item.label, colW, 'Helvetica', 9);
        doc.fillColor(MUTED).font('Helvetica').fontSize(9).text(item.label, x, iy, { width: colW });
        const valueFont = item.boldValue === false ? 'Helvetica' : 'Helvetica-Bold';
        doc
          .fillColor(NAVY)
          .font(valueFont)
          .fontSize(10.5)
          .text(item.value, x, iy + labelH + 2, { width: colW });
        iy += labelH + 2 + measure(item.value, colW, valueFont, 10.5) + 9;
      }
    };
    renderColumn(left, MARGIN + innerPad);
    renderColumn(right, MARGIN + innerPad + colW + gap);
    y = top + totalH + 4;
  };

  interface TableColumn {
    header: string;
    width: number;
    align?: 'left' | 'center';
  }

  /** Branded grid table: purple header, zebra rows, header repeat on breaks. */
  const table = (columns: TableColumn[], rows: string[][]) => {
    const headerH = 24;
    const drawHeader = () => {
      ensure(headerH);
      doc.save().fillColor(PURPLE).rect(MARGIN, y, CONTENT_W, headerH).fill().restore();
      let x = MARGIN;
      doc.fillColor(ON_PRIMARY).font('Helvetica-Bold').fontSize(9);
      for (const column of columns) {
        doc.text(column.header, x + PAD, y + 7, {
          width: column.width - PAD * 2,
          align: column.align ?? 'left',
        });
        x += column.width;
      }
      y += headerH;
    };
    const drawRow = (cells: string[], stripe: boolean) => {
      const font = 'Helvetica';
      let rowH = 0;
      cells.forEach((cell, index) => {
        const column = columns[index];
        if (!column) return;
        rowH = Math.max(rowH, measure(cell, column.width - PAD * 2, font, 9.5));
      });
      rowH += PAD * 2;
      if (y + rowH > BOTTOM_LIMIT) {
        nextPage();
        drawHeader();
      }
      if (stripe) {
        doc.save().fillColor(ZEBRA).rect(MARGIN, y, CONTENT_W, rowH).fill().restore();
      }
      let x = MARGIN;
      doc.fillColor(NAVY).font(font).fontSize(9.5);
      cells.forEach((cell, index) => {
        const column = columns[index];
        if (!column) return;
        doc.text(cell, x + PAD, y + PAD, {
          width: column.width - PAD * 2,
          align: column.align ?? 'left',
        });
        x += column.width;
      });
      doc.save().strokeColor(TABLE_GRID).lineWidth(0.5);
      let gx = MARGIN;
      for (const column of columns) {
        doc.rect(gx, y, column.width, rowH).stroke();
        gx += column.width;
      }
      doc.restore();
      y += rowH;
    };
    drawHeader();
    rows.forEach((cells, index) => drawRow(cells, index % 2 === 1));
  };

  /**
   * Numbered list inside card(s); paired mode renders two items per row.
   * Rows are chunked so a long list flows across pages with a fitting card
   * per page — content never slides under the footer furniture. When `bar`
   * is given, the section bar is drawn only once room for the bar plus the
   * first row exists, so the bar is never stranded alone at a page bottom.
   * Terms & Conditions passes `numbered: false` so plain editor lines are
   * rendered verbatim instead of gaining automatic "1." prefixes.
   */
  const numberedCard = (
    items: string[],
    paired: boolean,
    bar?: { title: string; icon: SectionIcon },
    numbered = true,
  ) => {
    const innerPad = 12;
    const gap = 20;
    const colW = (CONTENT_W - innerPad * 2 - gap) / 2;
    const fullW = CONTENT_W - innerPad * 2;
    interface Row {
      left: string;
      right: string;
      height: number;
    }
    const rows: Row[] = [];
    if (paired) {
      for (let index = 0; index < items.length; index += 2) {
        const left = `${index + 1}. ${items[index] ?? ''}`;
        const rightItem = items[index + 1];
        const right = rightItem === undefined ? '' : `${index + 2}. ${rightItem}`;
        rows.push({
          left,
          right,
          height:
            Math.max(measure(left, colW, 'Helvetica', 9.5), measure(right, colW, 'Helvetica', 9.5)) + 7,
        });
      }
    } else {
      items.forEach((item, index) => {
        const left = numbered ? `${index + 1}. ${item}` : item;
        rows.push({ left, right: '', height: measure(left, fullW - 16, 'Helvetica', 9.5) + 6 });
      });
    }
    // Chunk rows so each card fits the space left on the page (or a
    // fresh page) — content never slides under the footer furniture.
    // Bar lookahead: the bar (28 + 10 gap) plus the first row must fit,
    // otherwise the whole section starts on the next page — no orphan bars.
    // The trailing +4 reserves the inter-section gap so the first chunk can
    // never trip its own ensure below and strand the just-drawn bar.
    const pageBody = BOTTOM_LIMIT - MARGIN;
    if (bar && rows.length > 0) {
      const firstH = innerPad * 2 + (rows[0]?.height ?? 0);
      if (firstH + 4 > BOTTOM_LIMIT - y - (28 + 10)) nextPage();
      sectionBar(bar.title, bar.icon);
    }
    const chunks: Row[][] = [];
    let current: Row[] = [];
    // First chunk is bound by the space left on the current page.
    let spaceLeft = BOTTOM_LIMIT - y;
    let currentH = innerPad * 2;
    for (const row of rows) {
      if (current.length > 0 && currentH + row.height > spaceLeft) {
        chunks.push(current);
        current = [];
        currentH = innerPad * 2;
        spaceLeft = pageBody;
      }
      current.push(row);
      currentH += row.height;
    }
    if (current.length > 0) chunks.push(current);
    chunks.forEach((chunk, chunkIndex) => {
      const chunkH = chunk.reduce((sum, row) => sum + row.height, 0) + innerPad * 2;
      if (chunkIndex > 0) {
        nextPage();
      } else if (!bar) {
        // Bar-less cards keep the old fit check. With a bar, the lookahead
        // above already reserved bar + first row + gap and rows were chunked
        // against the space left after the bar — moving the chunk here would
        // strand the just-drawn bar alone at the page bottom.
        ensure(chunkH + 4);
      }
      const top = y;
      card(top, chunkH);
      let cy = top + innerPad;
      doc.fillColor(NAVY).font('Helvetica').fontSize(9.5);
      for (const row of chunk) {
        doc.text(row.left, MARGIN + innerPad + (paired ? 0 : 4), cy, {
          width: paired ? colW : fullW - 16,
        });
        if (paired && row.right) {
          doc.text(row.right, MARGIN + innerPad + colW + gap, cy, { width: colW });
          doc
            .save()
            .strokeColor(CARD_BORDER)
            .lineWidth(0.7)
            .moveTo(MARGIN + innerPad + colW + gap / 2, cy)
            .lineTo(MARGIN + innerPad + colW + gap / 2, cy + row.height - 4)
            .stroke()
            .restore();
        }
        cy += row.height;
      }
      y = top + chunkH + 4;
    });
  };

  /**
   * Agency header. Full variant (page 1): logo + name + contact lines on the
   * left, address + phone on the right, then the purple/gold divider.
   * Compact variant (continuation pages): company name plus the divider only
   * — the logo and contact lines never repeat past page 1.
   */
  const agencyHeader = (compact: boolean) => {
    const logoSize = compact ? 0 : 56;
    const logoDrawn = !compact && drawHeaderLogo(doc, company.logo ?? null, {
      x: MARGIN,
      y,
      width: logoSize,
      height: logoSize,
    });
    const textX = logoDrawn ? MARGIN + logoSize + 12 : MARGIN;
    if (!compact) {
      const nameW = CONTENT_W - (textX - MARGIN) - 180;
      doc.fillColor(NAVY).font('Helvetica-Bold').fontSize(20).text(company.name, textX, y + 2, {
        width: Math.max(nameW, 100),
      });
      // Contact lines start below the wrapped name so long names never
      // collide with the bullets.
      const nameH = measure(company.name, Math.max(nameW, 100), 'Helvetica-Bold', 20);
      const contactLines = [company.email, company.website].filter(
        (line): line is string => Boolean(line),
      );
      doc.fillColor(MUTED).font('Helvetica').fontSize(9);
      let lineY = y + 4 + nameH + 4;
      for (const line of contactLines.slice(0, 2)) {
        diamond(textX + 3, lineY + 4);
        doc.text(line, textX + 11, lineY, {
          width: CONTENT_W - (textX - MARGIN) - 190,
          ellipsis: true,
        });
        lineY += 12;
      }
      // Right block: address lines then phone, right aligned.
      const rightW = 168;
      const rightX = MARGIN + CONTENT_W - rightW;
      doc.fillColor(MUTED).font('Helvetica').fontSize(8.5);
      let rightY = y + 2;
      if (company.address) {
        const addrH = measure(company.address, rightW, 'Helvetica', 8.5);
        doc.text(company.address, rightX, rightY, { width: rightW, align: 'right' });
        rightY += addrH + 4;
      }
      if (company.phone) {
        doc.fillColor(NAVY).font('Helvetica-Bold').fontSize(9.5).text(company.phone, rightX, rightY, {
          width: rightW,
          align: 'right',
        });
        rightY += 13;
      }
      y = Math.max(lineY, rightY, y + logoSize) + 6;
    } else {
      // Continuation pages stay branded through the footer band, section
      // bars and page furniture — no repeated logo or contact block.
      const nameW = CONTENT_W - (textX - MARGIN);
      doc.fillColor(NAVY).font('Helvetica-Bold').fontSize(11).text(company.name, textX, y + 1, {
        width: nameW,
      });
      const nameH = measure(company.name, nameW, 'Helvetica-Bold', 11);
      y = y + 1 + nameH + 6;
    }
    y = divider(y);
  };

  // ------------------------------------------------------------------
  // Page 1: agency header, voucher title, Hotel / Guest / Stay details.
  // ------------------------------------------------------------------
  agencyHeader(false);

  // Title row: purple bed icon, HOTEL VOUCHER heading, confirmation card.
  // The confirmation card renders only when a confirmation number is saved;
  // a missing reference leaves no card and no placeholder behind.
  {
    const hasConfirmation = Boolean(voucher.confirmationNumber?.trim());
    const cardW = hasConfirmation ? 150 : 0;
    const cardH = 54;
    const titleW = CONTENT_W - (hasConfirmation ? cardW + 16 : 0);
    const sub = 'Please present this voucher at the hotel upon arrival.';
    const titleH = Math.max(cardH, 46 + measure(sub, titleW, 'Helvetica', 9.5) + 4);
    ensure(titleH + 6);
    const top = y;
    const iconBox = 46;
    doc.save().fillColor(PURPLE).roundedRect(MARGIN, top, iconBox, iconBox, 9).fill().restore();
    drawIcon('bed', MARGIN + (iconBox - 26) / 2, top + iconBox / 2, 26, ON_PRIMARY);
    doc
      .fillColor(NAVY)
      .font('Helvetica-Bold')
      .fontSize(23)
      .text('HOTEL VOUCHER', MARGIN + iconBox + 10, top + 1, { width: titleW - iconBox - 10 });
    doc.fillColor(MUTED).font('Helvetica').fontSize(9.5).text(sub, MARGIN + iconBox + 10, top + 30, {
      width: titleW - iconBox - 10,
    });
    // Confirmation card (actual voucher confirmation number only; omitted
    // entirely when none is saved).
    if (hasConfirmation) {
      const cardX = MARGIN + CONTENT_W - cardW;
      doc
        .save()
        .fillColor(BEIGE)
        .strokeColor(BEIGE_BORDER)
        .lineWidth(1)
        .roundedRect(cardX, top, cardW, cardH, 7)
        .fillAndStroke()
        .restore();
      drawIcon('doc', cardX + 10, top + cardH / 2, 16, PURPLE);
      // Small label stays navy so it reads on the beige card in any theme.
      // Uses the staff-customized label when set, else the default.
      doc
        .fillColor(NAVY)
        .font('Helvetica')
        .fontSize(8.5)
        .text(voucher.confirmationNumberLabel?.trim() || 'Confirmation No.', cardX + 30, top + 10, {
          width: cardW - 38,
        });
      doc
        .fillColor(NAVY)
        .font('Helvetica-Bold')
        .fontSize(16)
        .text(voucher.confirmationNumber ?? '—', cardX + 30, top + 24, {
          width: cardW - 38,
          ellipsis: true,
        });
    }
    y = top + titleH + 6;
  }

  // Hotel Details (first content section; no star rating ever).
  sectionBar('HOTEL DETAILS', 'building');
  {
    // A city already contained in the address text adds no value as a
    // separate line, so it is folded away (the address itself is untouched).
    const addressText = voucher.hotelAddress?.trim() ? voucher.hotelAddress.trim() : null;
    const cityText = voucher.hotelCity?.trim() ? voucher.hotelCity.trim() : null;
    const cityRedundant =
      addressText !== null &&
      cityText !== null &&
      addressText.toLowerCase().includes(cityText.toLowerCase());
    const left: FieldItem[] = [];
    if (addressText) {
      left.push({
        label: 'Address',
        value: !cityRedundant && cityText ? `${addressText}\n${cityText}` : addressText,
        boldValue: false,
      });
    } else if (cityText) {
      left.push({ label: 'Address', value: cityText, boldValue: false });
    }
    const right: FieldItem[] = [];
    if (voucher.hotelPhone) right.push({ label: 'Phone', value: voucher.hotelPhone, boldValue: false });
    if (voucher.hotelEmail) right.push({ label: 'Email', value: voucher.hotelEmail, boldValue: false });
    // Confirmation No. lives only in the top-right header card — it is
    // intentionally not repeated here. Booking ID stays in this box.
    // Omitted entirely when absent — never a placeholder or a guess.
    if (voucher.bookingId)
      right.push({ label: voucher.bookingIdLabel?.trim() || 'Booking ID', value: voucher.bookingId });
    // The hotel identity always sits in the standard profile card so the
    // section keeps one unified shape with or without contact details.
    profileBlock(voucher.hotelName, left, right);
  }

  // Guest Details (room count lives here, never in Stay Details).
  sectionBar('GUEST DETAILS', 'person');
  {
    const left: FieldItem[] = [];
    if (voucher.guestPhone) left.push({ label: 'Phone', value: voucher.guestPhone, boldValue: false });
    if (voucher.guestEmail) left.push({ label: 'Email', value: voucher.guestEmail, boldValue: false });
    const right: FieldItem[] = [
      { label: 'Adults', value: String(voucher.adults) },
      { label: 'Children', value: String(voucher.children) },
      { label: 'No. of Rooms', value: String(voucher.rooms) },
    ];
    profileBlock(voucher.guestName, left, right);
  }

  // Stay Details: five stat blocks with icons, dates without weekday names.
  // Room types and meal plans live in the tables below (every saved entry,
  // never just the first); the cards carry the document totals.
  sectionBar('STAY DETAILS', 'calendar');
  {
    const nights = Math.max(
      0,
      Math.round((voucher.checkOut.getTime() - voucher.checkIn.getTime()) / 86_400_000),
    );
    const mealCount = voucher.stayMeals.length;
    const stats: Array<{ label: string; value: string; icon: SectionIcon }> = [
      { label: 'Check-in', value: fmtDate(voucher.checkIn), icon: 'calendar' },
      { label: 'Check-out', value: fmtDate(voucher.checkOut), icon: 'calendar' },
      { label: 'Nights', value: String(nights), icon: 'moon' },
      {
        label: 'Total Rooms',
        value: `${voucher.rooms} Room${voucher.rooms === 1 ? '' : 's'}`,
        icon: 'bed',
      },
      {
        label: 'Meal Plans',
        value: mealCount === 0 ? '—' : `${mealCount} Plan${mealCount === 1 ? '' : 's'}`,
        icon: 'list',
      },
    ];
    const colW = CONTENT_W / stats.length;
    const height = 66;
    ensure(height + 4);
    const top = y;
    card(top, height);
    stats.forEach((stat, index) => {
      const x = MARGIN + index * colW;
      if (index > 0) {
        doc
          .save()
          .strokeColor(CARD_BORDER)
          .lineWidth(0.7)
          .moveTo(x, top + 8)
          .lineTo(x, top + height - 8)
          .stroke()
          .restore();
      }
      drawIcon(stat.icon, x + (colW - 8) / 2 - 6, top + 15, 13, PURPLE);
      doc.fillColor(MUTED).font('Helvetica').fontSize(8.5).text(stat.label, x + 4, top + 26, {
        width: colW - 8,
        align: 'center',
      });
      // Single line with ellipsis: long values must never spill out of the
      // card.
      doc.fillColor(NAVY).font('Helvetica-Bold').fontSize(10.5).text(stat.value, x + 4, top + 40, {
        width: colW - 8,
        height: 14,
        ellipsis: true,
        align: 'center',
      });
    });
    y = top + height + 4;
  }

  // Room configurations: every saved entry with its quantity and, when
  // present, its remark. The Remark column renders only when at least one
  // room carries a non-empty remark; otherwise Room Type absorbs the width.
  // Extra-bed and child-without-bed counts are voucher data no longer —
  // they are never collected, stored, or printed here.
  if (voucher.stayRooms.length > 0) {
    // Keep the bar together with the table header plus one body row.
    sectionBar('ROOM DETAILS', 'bed', 24 + 32);
    // Column widths sum exactly to CONTENT_W so the purple header, zebra
    // stripes, and grid share one right edge. Room Type absorbs the width
    // freed by the removed columns so long names keep room to wrap.
    const showRemark = voucher.stayRooms.some((row) => (row.notes ?? '').trim().length > 0);
    const remarkW = 150;
    const roomTypeW = CONTENT_W - (32 + 55 + (showRemark ? remarkW : 0));
    table(
      [
        { header: '#', width: 32, align: 'center' as const },
        { header: 'Room Type', width: roomTypeW, align: 'left' as const },
        { header: 'Rooms', width: 55, align: 'center' as const },
        ...(showRemark
          ? [{ header: 'Remark', width: remarkW, align: 'left' as const }]
          : []),
      ],
      voucher.stayRooms.map((row, index) => [
        String(index + 1),
        row.roomType,
        String(row.rooms),
        ...(showRemark ? [(row.notes ?? '').trim() ? (row.notes as string).trim() : '—'] : []),
      ]),
    );
    y += 8;
  }

  // Meal plans: every saved selection in its stored order.
  if (voucher.stayMeals.length > 0) {
    // Keep the bar together with the table header plus one body row.
    sectionBar('MEAL PLANS', 'list', 24 + 32);
    const mealW = CONTENT_W - 36;
    table(
      [
        { header: '#', width: 36, align: 'center' as const },
        { header: 'Meal Plan', width: mealW, align: 'left' as const },
      ],
      voucher.stayMeals.map((row, index) => [String(index + 1), row.mealPlan]),
    );
    y += 8;
  }

  // ------------------------------------------------------------------
  // Remaining sections flow onto the current page (or the next one when
  // they genuinely do not fit). Sections keep their fixed order; tables
  // and lists break across pages row by row. No forced page break: a
  // near-empty trailing page would violate the bottom-whitespace rule.
  // ------------------------------------------------------------------
  {
    if (voucher.guests.length > 0) {
      // Keep the bar together with the table header plus one body row.
      // The third column carries Adult/Child values, so it is headed
      // exactly that — never the misleading "No of Pax".
      sectionBar('GUEST INFORMATION', 'person', 24 + 32);
      const guestLastW = CONTENT_W - (36 + 310);
      table(
        [
          { header: '#', width: 36, align: 'center' as const },
          { header: 'Guest Name', width: 310, align: 'left' as const },
          { header: 'Adult / Child', width: guestLastW, align: 'center' as const },
        ],
        voucher.guests.map((guest, index) => [
          String(index + 1),
          guest.guestName,
          guest.paxType === 'ADULT' ? 'Adult' : 'Child',
        ]),
      );
      y += 8;
    }

    if (voucher.packageIncludes !== null && voucher.packageIncludes.length > 0) {
      numberedCard(
        voucher.packageIncludes.map(voucherPackageLine).filter((line) => line.length > 0),
        true,
        { title: 'PACKAGE INCLUDES', icon: 'list' },
      );
      y += 4;
    }

    const terms = voucherTextLines(voucher.termsSnapshot ?? '');
    if (terms.length > 0) {
      numberedCard(terms, false, { title: 'TERMS & CONDITIONS', icon: 'doc' }, false);
    }
  }

  // Page furniture: subtle lavender top strip, primary/gold footer accent,
  // and page numbering on every page. Everything below the content limit
  // lives inside the bottom 30pt so full pages never breach the whitespace
  // rule; content can touch (never cross) the accent rule.
  const pages = doc.bufferedPageRange();
  for (let page = 0; page < pages.count; page += 1) {
    doc.switchToPage(page);
    doc.save().fillColor(LAVENDER).rect(0, 0, PAGE_W, 7).fill().restore();
    doc.save().fillColor(GOLD_LIGHT).rect(0, 7, PAGE_W, 1.2).fill().restore();
    doc.save().fillColor(LAVENDER_DEEP).rect(0, PAGE_H - 26, PAGE_W, 26).fill().restore();
    doc.save().fillColor(PURPLE).rect(0, PAGE_H - 30, PAGE_W - 180, 2).fill().restore();
    doc.save().fillColor(GOLD).rect(0, PAGE_H - 27.2, PAGE_W - 260, 1).fill().restore();
    doc
      .font('Helvetica')
      .fontSize(8)
      .fillColor(MUTED)
      .text(`Page ${page + 1} of ${pages.count}`, MARGIN, PAGE_H - 20, {
        align: 'right',
        width: CONTENT_W,
      });
  }
  doc.end();
  return done;
}
