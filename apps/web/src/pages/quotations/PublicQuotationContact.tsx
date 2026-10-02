import { Mail, MapPin, MessageCircle, Phone, User } from 'lucide-react';
import { buildQuotationDescription, normalizeWhatsAppPhone } from './quotationContact';

export interface PublicQuotationContactProps {
  companyName: string;
  contactPerson: string | null | undefined;
  phone: string | null | undefined;
  gstin: string | null | undefined;
  email: string | null | undefined;
  address: string | null | undefined;
  logoUrl: string | null | undefined;
  quotationId: string | null | undefined;
  quotationTitle: string | null | undefined;
  leadName: string | null | undefined;
}

const infoRow = 'flex items-start gap-2 text-sm text-[#000000]';
const icon = 'mt-0.5 h-4 w-4 shrink-0 text-emerald-600';

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
  logoUrl,
  quotationId,
  quotationTitle,
  leadName,
}: PublicQuotationContactProps) {
  const description = buildQuotationDescription(quotationId, quotationTitle, leadName);
  const whatsappPhone = normalizeWhatsAppPhone(phone);
  const message = `Hello, I'm interested in the travel quotation (ID: ${description})`;
  return (
    <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
      <div className="flex flex-col gap-6 md:flex-row md:items-start md:justify-between">
        <div className="min-w-0 flex-1 space-y-5">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-start gap-3 min-w-0 flex-1">
              <span aria-hidden="true" className="mt-1.5 h-6 w-1 shrink-0 rounded bg-emerald-600" />
              <div className="min-w-0 flex-1">
                <h2 className="text-xl font-bold text-[#000000]">Contact Us</h2>
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
            {gstin?.trim() && (
              <p className={infoRow}>
                <span
                  aria-hidden="true"
                  className="mt-0.5 inline-flex h-4 shrink-0 items-center rounded bg-emerald-600 px-1 text-[10px] font-bold leading-none text-white"
                >
                  GST
                </span>
                <span>{gstin.trim()}</span>
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
                <MessageCircle className="h-4 w-4" aria-hidden="true" /> WhatsApp
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
