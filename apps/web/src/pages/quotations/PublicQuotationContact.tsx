import { ExternalLink, Mail, MapPin, Phone, User } from 'lucide-react';
import { buildQuotationDescription, normalizeWhatsAppPhone } from './quotationContact';

export interface PublicQuotationContactProps {
  companyName: string;
  contactPerson: string | null | undefined;
  phone: string | null | undefined;
  gstin: string | null | undefined;
  email: string | null | undefined;
  address: string | null | undefined;
  googleMapsUrl?: string | null | undefined;
  logoUrl: string | null | undefined;
  quotationId: string | null | undefined;
  quotationTitle: string | null | undefined;
  leadName: string | null | undefined;
}

const infoRow = 'flex items-start gap-2 text-sm text-[#000000]';
const icon = 'mt-0.5 h-4 w-4 shrink-0 text-emerald-600';

/**
 * Official WhatsApp brand glyph (Simple Icons path), inheriting the
 * surrounding text color so it stays in the Contact Us green theme.
 * Neither lucide-react nor any project dependency ships a WhatsApp brand
 * icon, so the glyph lives here next to its only usage.
 */
function WhatsAppIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true" focusable="false">
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
    </svg>
  );
}

/**
 * Outline document-style GST glyph with the letters drawn inside the icon,
 * following the lucide stroke convention (2px, currentColor) so it matches
 * the other Contact Us row icons in size, colour, weight and alignment.
 * lucide-react ships no GST-specific icon, so the glyph lives here next to
 * its only usage.
 */
function GstIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <path d="M14 2v6h6" />
      <text
        x="12"
        y="17.5"
        textAnchor="middle"
        fontSize="6"
        fontWeight="700"
        fill="currentColor"
        stroke="none"
      >
        GST
      </text>
    </svg>
  );
}

/** Only http(s) links are rendered; anything else hides the row entirely. */
function safeExternalUrl(value: string | null | undefined): string | null {
  const url = (value ?? '').trim();
  return /^https?:\/\//i.test(url) ? url : null;
}

/**
 * Left-aligned contact card for the public quotation web link. All values come
 * from Company Settings / the quotation via the existing public API; rows and
 * buttons are hidden when their value is missing, and the logo area is omitted
 * entirely when no logo is configured.
 */
export function PublicQuotationContact({
  companyName,
  contactPerson,
  phone,
  gstin,
  email,
  address,
  googleMapsUrl = null,
  logoUrl,
  quotationId,
  quotationTitle,
  leadName,
}: PublicQuotationContactProps) {
  const description = buildQuotationDescription(quotationId, quotationTitle, leadName);
  const whatsappPhone = normalizeWhatsAppPhone(phone);
  const mapsUrl = safeExternalUrl(googleMapsUrl);
  const message = `Hello, I'm interested in the travel quotation (ID: ${description})`;
  return (
    <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
      <div className="flex flex-col gap-6 md:flex-row md:items-start md:justify-between">
        <div className="min-w-0 flex-1 space-y-5">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-start gap-3 min-w-0 flex-1">
              <span aria-hidden="true" className="mt-1.5 h-6 w-1 shrink-0 rounded bg-emerald-600" />
              <div className="min-w-0 flex-1">
                <h2
                  id="contact-us"
                  data-section-title="Contact Us"
                  className="scroll-mt-24 text-xl font-bold text-[#000000]"
                >
                  Contact Us
                </h2>
                <p className="mt-1.5 max-w-xl text-sm leading-relaxed text-[#000000]">
                  Ready to book this amazing journey or have questions? Get in touch with us for more
                  information.
                </p>
              </div>
            </div>
            {logoUrl && (
              <div className="flex h-24 w-24 shrink-0 items-center justify-center rounded-lg bg-slate-100 p-2 md:hidden">
                <img
                  src={logoUrl}
                  alt={`${companyName} logo`}
                  className="max-h-full max-w-full object-contain"
                />
              </div>
            )}
          </div>

          <div className="space-y-2.5">
            <p className="text-base font-semibold text-[#000000]">{companyName}</p>
            {contactPerson && (
              <p className={infoRow}>
                <User className={icon} aria-hidden="true" />
                <span>{contactPerson}</span>
              </p>
            )}
            {phone && (
              <p className={infoRow}>
                <Phone className={icon} aria-hidden="true" />
                <a href={`tel:${phone}`} className="text-blue-600 hover:underline">
                  {phone}
                </a>
              </p>
            )}
            {email && (
              <p className={infoRow}>
                <Mail className={icon} aria-hidden="true" />
                <a href={`mailto:${email}`} className="break-all text-blue-600 hover:underline">
                  {email}
                </a>
              </p>
            )}
            {address && (
              <p className={infoRow}>
                <MapPin className={icon} aria-hidden="true" />
                <span>{address}</span>
              </p>
            )}
            {mapsUrl && (
              <p className={infoRow}>
                <MapPin className={icon} aria-hidden="true" />
                <a
                  href={mapsUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 text-blue-600 hover:underline"
                >
                  View on Google Maps
                  <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                </a>
              </p>
            )}
            {gstin?.trim() && (
              <p className={infoRow}>
                <GstIcon className={icon} />
                <span>{gstin.trim()}</span>
              </p>
            )}
          </div>

          <div className="flex flex-wrap gap-2">
            {phone && (
              <a
                href={`tel:${phone}`}
                className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700"
              >
                <Phone className="h-4 w-4" aria-hidden="true" /> Call Now
              </a>
            )}
            {whatsappPhone && (
              <a
                href={`https://wa.me/${whatsappPhone}?text=${encodeURIComponent(message)}`}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-2 rounded-lg border border-emerald-600 bg-white px-4 py-2 text-sm font-medium text-emerald-700 hover:bg-emerald-50"
              >
                <WhatsAppIcon className="h-4 w-4" /> WhatsApp
              </a>
            )}
          </div>
        </div>

        {logoUrl && (
          <div className="hidden h-40 w-40 shrink-0 items-center justify-center rounded-lg bg-slate-100 p-3 md:flex md:self-start">
            <img
              src={logoUrl}
              alt={`${companyName} logo`}
              className="max-h-full max-w-full object-contain"
            />
          </div>
        )}
      </div>
    </section>
  );
}
