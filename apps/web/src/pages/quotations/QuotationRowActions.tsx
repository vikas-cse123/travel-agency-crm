import { useRef, useState } from 'react';
import { Check, Copy, ExternalLink, FileDown, MessageCircle } from 'lucide-react';
import { PERMISSIONS } from '@interscale/shared';
import { useAuth } from '@/features/auth/AuthProvider';
import {
  useGenerateQuotationPdf,
  useQuotationAction,
  type Quotation,
} from '@/features/quotations/quotations.api';
import { WhatsappSummaryDialog } from './WhatsappSummaryDialog';

const iconButtonClass =
  'inline-flex h-7 w-7 items-center justify-center rounded-md text-slate-500 transition hover:bg-slate-100 hover:text-slate-800 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60';

/**
 * Compact per-row actions for the quotations list, reusing the detail page's
 * implementations: PDF generation (`useGenerateQuotationPdf`), weblink
 * provisioning (`public-link` action) and the shared WhatsApp dialog. Every
 * action targets this row's quotation and its current version.
 */
export function QuotationRowActions({ quotation }: { quotation: Quotation }) {
  const { hasPermission, user } = useAuth();
  const action = useQuotationAction(quotation.id);
  const generatePdf = useGenerateQuotationPdf(quotation.id);
  const current =
    quotation.versions.find((version) => version.id === quotation.currentVersionId) ??
    quotation.versions[0];
  const [linkCopied, setLinkCopied] = useState(false);
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [weblinkUrl, setWeblinkUrl] = useState<string | null>(null);
  const [weblinkVersionId, setWeblinkVersionId] = useState<string | null>(null);
  const [whatsappOpen, setWhatsappOpen] = useState(false);
  const [error, setError] = useState('');

  /** Provision the public weblink for the row's current version (lazy so the
   *  list never fires one request per row on load). Cached per version. */
  const ensurePublicLink = (): Promise<string | null> =>
    new Promise((resolve) => {
      if (!current) return resolve(null);
      if (weblinkUrl && weblinkVersionId === current.id) return resolve(weblinkUrl);
      action.mutate(
        { path: 'public-link', body: { quotationVersionId: current.id } },
        {
          onSuccess: (result) => {
            const url = (result as { url?: string }).url ?? null;
            if (url) {
              setWeblinkUrl(url);
              setWeblinkVersionId(current.id);
            }
            resolve(url);
          },
          onError: () => resolve(null),
        },
      );
    });

  const generateRowPdf = () => {
    if (!current || generatePdf.isPending) return;
    setError('');
    const pdfTab = window.open('about:blank', '_blank');
    if (!pdfTab) {
      setError('Allow pop-ups for this site so the generated PDF can open in a new tab.');
      return;
    }
    pdfTab.opener = null;
    pdfTab.document.title = 'Generating PDF…';
    pdfTab.document.body.innerHTML =
      '<p style="font:16px system-ui;padding:32px">Generating PDF…</p>';
    generatePdf.mutate(
      { versionId: current.id, style: 'CLASSIC' },
      {
        onSuccess: ({ url }) => {
          if (url) pdfTab.location.replace(url);
        },
        onError: () => {
          pdfTab.close();
          setError('PDF generation failed. Please try again.');
        },
      },
    );
  };

  const copyRowLink = async () => {
    const url = await ensurePublicLink();
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setLinkCopied(true);
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
      copyTimerRef.current = setTimeout(() => setLinkCopied(false), 1800);
    } catch {
      // Copy failed — do not show confirmation.
    }
  };

  const previewRowLink = async () => {
    if (weblinkUrl && weblinkVersionId === current?.id) {
      window.open(weblinkUrl, '_blank', 'noopener');
      return;
    }
    const win = window.open('about:blank', '_blank');
    if (!win) {
      setError('Allow pop-ups for this site so the weblink preview can open in a new tab.');
      return;
    }
    win.opener = null;
    win.document.title = 'Opening preview…';
    win.document.body.innerHTML =
      '<p style="font:16px system-ui;padding:32px">Opening preview…</p>';
    const url = await ensurePublicLink();
    if (url) win.location.replace(url);
    else {
      win.close();
      setError('The weblink preview could not be opened. Please try again.');
    }
  };

  const openRowWhatsapp = async () => {
    if (current?.status !== 'DRAFT' && !(weblinkUrl && weblinkVersionId === current?.id)) {
      await ensurePublicLink();
    }
    setWhatsappOpen(true);
  };

  const provisioning = action.isPending;
  return (
    <div>
      <div className="flex items-center gap-0.5 whitespace-nowrap" role="group" aria-label={`Actions for ${quotation.quotationNumber}`}>
        {current && hasPermission(PERMISSIONS.QUOTATIONS_GENERATE_PDF) && (
          <button
            type="button"
            title={generatePdf.isPending ? 'Generating PDF…' : 'Generate PDF'}
            aria-label={`Generate PDF for ${quotation.quotationNumber}`}
            aria-busy={generatePdf.isPending}
            disabled={generatePdf.isPending}
            onClick={generateRowPdf}
            className={iconButtonClass}
          >
            <FileDown className="h-4 w-4" aria-hidden="true" />
          </button>
        )}
        <button
          type="button"
          title={linkCopied ? 'Copied!' : 'Copy Weblink URL'}
          aria-label={`Copy Weblink URL for ${quotation.quotationNumber}`}
          disabled={!current || provisioning}
          onClick={() => void copyRowLink()}
          className={iconButtonClass}
        >
          {linkCopied ? (
            <Check className="h-4 w-4 text-emerald-600" aria-hidden="true" />
          ) : (
            <Copy className="h-4 w-4" aria-hidden="true" />
          )}
        </button>
        <button
          type="button"
          title="Preview Weblink"
          aria-label={`Preview Weblink for ${quotation.quotationNumber}`}
          disabled={!current || provisioning}
          onClick={() => void previewRowLink()}
          className={iconButtonClass}
        >
          <ExternalLink className="h-4 w-4" aria-hidden="true" />
        </button>
        <button
          type="button"
          title="WhatsApp Message"
          aria-label={`WhatsApp Message for ${quotation.quotationNumber}`}
          disabled={!current}
          onClick={() => void openRowWhatsapp()}
          className={iconButtonClass}
        >
          <MessageCircle className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
      {error && (
        <p role="alert" className="mt-1 max-w-44 text-xs text-red-600">
          {error}
        </p>
      )}
      {current && (
        <WhatsappSummaryDialog
          open={whatsappOpen}
          onClose={() => setWhatsappOpen(false)}
          quotation={quotation}
          version={current}
          weblinkUrl={weblinkUrl}
          companyName={user?.company.name ?? 'Travel Agency CRM'}
          preparedByName={quotation.createdBy?.fullName ?? user?.fullName ?? null}
        />
      )}
    </div>
  );
}
