import PDFDocument from 'pdfkit';
import { drawHeaderLogo, type CompanyBranding } from '../../services/pdf/company-branding.js';
import { DEJAVU_SANS, DEJAVU_SANS_BOLD } from '../../services/pdf/fonts.js';

/**
 * Standalone Payment Voucher PDF — customer-facing proof of a single
 * CustomerPayment. Carries NO booking information: the voucher belongs to
 * the standalone Payments module (PaymentCase → CustomerPayment →
 * PaymentReceipt) and renders only prepared display strings.
 *
 * Totals (previously paid, total paid, outstanding, status) are computed by
 * the payments service from the case's agreed trip amount and its collected
 * payments — the renderer performs no financial computation.
 */

export interface PaymentVoucherPdfData {
  receiptNumber: string;
  paymentNumber: string;
  /** Preformatted payment date, e.g. "9 Oct 2026". */
  receivedAt: string;
  customerName: string;
  tripTitle: string;
  /** Preformatted amounts in the payment currency, e.g. "₹10,000.00". */
  amount: string;
  /** Display label, e.g. "UPI". */
  paymentMethod: string;
  referenceNumber: string | null;
  bankName: string | null;
  notes: string | null;
  totalTripAmount: string;
  previouslyPaid: string;
  totalPaid: string;
  outstanding: string;
  /** Display label, e.g. "Partially paid". */
  paymentStatus: string;
}

const NAVY = '#1e3a5f';
const MUTED = '#64748b';
const BAR_BLUE = '#d9e8f5';
const BEIGE = '#f6f0df';
const GRID = '#d5dde5';
const RULE = '#94a3b8';

const PAGE_W = 595.28;
const PAGE_H = 841.89;
const MARGIN = 44;
const CONTENT_W = PAGE_W - MARGIN * 2;
const BOTTOM_LIMIT = PAGE_H - 64;
const PAD = 6;

export async function renderPaymentVoucherPdf(input: {
  company: CompanyBranding;
  receipt: PaymentVoucherPdfData;
}): Promise<Buffer> {
  const { company, receipt } = input;
  const doc = new PDFDocument({ size: 'A4', margin: 0, bufferPages: true });
  // Embedded DejaVu renders the ₹ sign and other non-WinAnsi glyphs that
  // standard PDF fonts cannot (same approach as the quotation PDFs).
  doc.registerFont('Body', DEJAVU_SANS);
  doc.registerFont('Bold', DEJAVU_SANS_BOLD);
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
      doc.addPage();
      y = MARGIN;
    }
  };

  const measure = (text: string, width: number, font: string, size: number): number => {
    doc.font(font).fontSize(size);
    return doc.heightOfString(text, { width });
  };

  /** Light-blue section bar with navy caps title. Fixed height. */
  const sectionBar = (title: string, fill: string = BAR_BLUE) => {
    const height = 26;
    ensure(height + 8);
    doc.save().roundedRect(MARGIN, y, CONTENT_W, height, 4).fill(fill).restore();
    doc
      .fillColor(NAVY)
      .font('Bold')
      .fontSize(11.5)
      .text(title, MARGIN + 12, y + 7, { width: CONTENT_W - 24, characterSpacing: 0.8 });
    y += height + 10;
  };

  /** Label/value pair; value wraps. Drawn at the current cursor. */
  const field = (
    x: number,
    width: number,
    label: string,
    value: string,
    opts: { valueSize?: number; boldValue?: boolean } = {},
  ): number => {
    const valueFont = opts.boldValue === false ? 'Body' : 'Bold';
    const valueSize = opts.valueSize ?? 10.5;
    const labelH = measure(label, width, 'Body', 9);
    const valueH = measure(value, width, valueFont, valueSize);
    const height = labelH + 2 + valueH;
    ensure(height);
    doc.fillColor(MUTED).font('Body').fontSize(9).text(label, x, y, { width });
    doc
      .fillColor(NAVY)
      .font(valueFont)
      .fontSize(valueSize)
      .text(value, x, y + labelH + 2, { width });
    y += height;
    return height;
  };

  // ------------------------------------------------------------------
  // Agency header: logo + name on the left, contact lines on the right.
  // ------------------------------------------------------------------
  const logoDrawn = drawHeaderLogo(doc, company.logo ?? null, {
    x: MARGIN,
    y: 40,
    width: 140,
    height: 44,
  });
  const headerTextX = logoDrawn ? MARGIN + 152 : MARGIN;
  const headerTextW = CONTENT_W - (logoDrawn ? 152 : 0) - 180;
  doc
    .fillColor(NAVY)
    .font('Bold')
    .fontSize(19)
    .text(company.name, headerTextX, 42, {
      width: Math.max(headerTextW, 100),
      ellipsis: true,
    });
  const contactLines = [company.address, company.phone, company.email, company.website].filter(
    (line): line is string => Boolean(line),
  );
  doc.fillColor(MUTED).font('Body').fontSize(9);
  let contactY = 68;
  for (const line of contactLines.slice(0, 4)) {
    doc.text(line, headerTextX, contactY, { width: Math.max(headerTextW, 100), ellipsis: true });
    contactY += 12;
  }
  y = 122;

  // Title block.
  ensure(44);
  doc.fillColor(NAVY).font('Bold').fontSize(17).text('PAYMENT VOUCHER', MARGIN, y, {
    width: CONTENT_W,
    characterSpacing: 1,
  });
  y = doc.y + 4;
  doc
    .save()
    .strokeColor(RULE)
    .lineWidth(1)
    .moveTo(MARGIN, y)
    .lineTo(MARGIN + CONTENT_W, y)
    .stroke()
    .restore();
  y += 14;

  // Receipt / payment / customer identity grid.
  {
    const gap = 20;
    const colW = (CONTENT_W - gap) / 2;
    const left: Array<{ label: string; value: string; size?: number }> = [
      { label: 'Receipt No.', value: receipt.receiptNumber, size: 13 },
      { label: 'Payment No.', value: receipt.paymentNumber },
      { label: 'Payment Date', value: receipt.receivedAt },
    ];
    const right: Array<{ label: string; value: string; size?: number }> = [
      { label: 'Customer', value: receipt.customerName },
      { label: 'Trip', value: receipt.tripTitle },
    ];
    const blockHeight = (items: typeof left): number =>
      items.reduce((sum, item) => {
        const labelH = measure(item.label, colW, 'Body', 9);
        const valueH = measure(item.value, colW, 'Bold', item.size ?? 10.5);
        return sum + labelH + 2 + valueH + 10;
      }, 0);
    const height = Math.max(blockHeight(left), blockHeight(right), 20);
    ensure(height);
    const top = y;
    const dividerX = MARGIN + colW + gap / 2;
    doc
      .save()
      .strokeColor(GRID)
      .lineWidth(0.5)
      .moveTo(dividerX, top)
      .lineTo(dividerX, top + height)
      .stroke()
      .restore();
    const drawColumn = (items: typeof left, x: number) => {
      let cy = top;
      for (const item of items) {
        const size = item.size ?? 10.5;
        const labelH = measure(item.label, colW, 'Body', 9);
        const valueH = measure(item.value, colW, 'Bold', size);
        doc.fillColor(MUTED).font('Body').fontSize(9).text(item.label, x, cy, { width: colW });
        doc
          .fillColor(NAVY)
          .font('Bold')
          .fontSize(size)
          .text(item.value, x, cy + labelH + 2, { width: colW });
        cy += labelH + 2 + valueH + 10;
      }
    };
    drawColumn(left, MARGIN);
    drawColumn(right, MARGIN + colW + gap);
    y = top + height + 4;
  }

  // Payment details.
  sectionBar('PAYMENT DETAILS');
  field(MARGIN, CONTENT_W, 'Amount Received', receipt.amount, { valueSize: 15 });
  y += 6;
  {
    const gap = 20;
    const colW = (CONTENT_W - gap) / 2;
    const left: Array<{ label: string; value: string }> = [
      { label: 'Payment Method', value: receipt.paymentMethod },
    ];
    if (receipt.referenceNumber) left.push({ label: 'Reference', value: receipt.referenceNumber });
    const right: Array<{ label: string; value: string }> = [];
    if (receipt.bankName) right.push({ label: 'Bank', value: receipt.bankName });
    if (left.length > 0 || right.length > 0) {
      const blockHeight = (items: typeof left): number =>
        items.reduce((sum, item) => {
          const labelH = measure(item.label, colW, 'Body', 9);
          const valueH = measure(item.value, colW, 'Bold', 10.5);
          return sum + labelH + 2 + valueH + 10;
        }, 0);
      const height = Math.max(blockHeight(left), blockHeight(right), 20);
      ensure(height);
      const top = y;
      if (right.length > 0) {
        const dividerX = MARGIN + colW + gap / 2;
        doc
          .save()
          .strokeColor(GRID)
          .lineWidth(0.5)
          .moveTo(dividerX, top)
          .lineTo(dividerX, top + height)
          .stroke()
          .restore();
      }
      const drawColumn = (items: typeof left, x: number) => {
        let cy = top;
        for (const item of items) {
          const labelH = measure(item.label, colW, 'Body', 9);
          const valueH = measure(item.value, colW, 'Bold', 10.5);
          doc.fillColor(MUTED).font('Body').fontSize(9).text(item.label, x, cy, { width: colW });
          doc
            .fillColor(NAVY)
            .font('Bold')
            .fontSize(10.5)
            .text(item.value, x, cy + labelH + 2, { width: colW });
          cy += labelH + 2 + valueH + 10;
        }
      };
      drawColumn(left, MARGIN);
      drawColumn(right, MARGIN + colW + gap);
      y = top + height;
    }
  }
  if (receipt.notes) {
    y += 2;
    field(MARGIN, CONTENT_W, 'Notes', receipt.notes, { boldValue: false });
  }
  y += 4;

  // Trip payment summary: label/value rows, balance highlighted.
  sectionBar('TRIP PAYMENT SUMMARY');
  {
    const rows: Array<{ label: string; value: string; highlight?: boolean }> = [
      { label: 'Total Trip Amount', value: receipt.totalTripAmount },
      { label: 'Previously Paid', value: receipt.previouslyPaid },
      { label: 'This Payment', value: receipt.amount },
      { label: 'Total Paid', value: receipt.totalPaid },
      { label: 'Balance Remaining', value: receipt.outstanding, highlight: true },
    ];
    const labelW = 200;
    const valueW = CONTENT_W - labelW - PAD * 2;
    for (const row of rows) {
      const rowH =
        Math.max(measure(row.label, labelW, 'Body', 10), measure(row.value, valueW, 'Bold', 11)) +
        14;
      ensure(rowH);
      if (row.highlight) {
        doc.save().fillColor(BEIGE).rect(MARGIN, y, CONTENT_W, rowH).fill().restore();
      }
      doc
        .fillColor(MUTED)
        .font('Body')
        .fontSize(10)
        .text(row.label, MARGIN + PAD, y + 7, {
          width: labelW,
        });
      doc
        .fillColor(NAVY)
        .font('Bold')
        .fontSize(11)
        .text(row.value, MARGIN + PAD + labelW, y + 7, { width: valueW, align: 'right' });
      doc
        .save()
        .strokeColor(GRID)
        .lineWidth(0.5)
        .moveTo(MARGIN, y + rowH)
        .lineTo(MARGIN + CONTENT_W, y + rowH)
        .stroke()
        .restore();
      y += rowH;
    }
    y += 6;
  }

  // Payment status badge.
  sectionBar('PAYMENT STATUS');
  {
    const badgeH = 30;
    ensure(badgeH);
    const textW = measure(receipt.paymentStatus.toUpperCase(), CONTENT_W, 'Bold', 12) + 48;
    const badgeW = Math.min(CONTENT_W, Math.max(180, textW));
    const badgeX = MARGIN + (CONTENT_W - badgeW) / 2;
    doc.save().roundedRect(badgeX, y, badgeW, badgeH, 6).fill(BEIGE).restore();
    doc.save().roundedRect(badgeX, y, badgeW, badgeH, 6).stroke(NAVY).restore();
    doc
      .fillColor(NAVY)
      .font('Bold')
      .fontSize(12)
      .text(receipt.paymentStatus.toUpperCase(), badgeX, y + 9, {
        width: badgeW,
        align: 'center',
        characterSpacing: 0.6,
      });
    y += badgeH + 6;
  }

  const pages = doc.bufferedPageRange();
  for (let page = 0; page < pages.count; page += 1) {
    doc.switchToPage(page);
    doc
      .fontSize(8)
      .fillColor(MUTED)
      .text(`Page ${page + 1} of ${pages.count}`, MARGIN, PAGE_H - 40, {
        align: 'right',
        width: CONTENT_W,
      });
  }
  doc.end();
  return done;
}
