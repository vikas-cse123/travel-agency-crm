import { useEffect, useRef, useState } from 'react';
import {
  Bold,
  CarFront,
  Copy,
  Heading1,
  Italic,
  List,
  MessageCircle,
  Plane,
  RotateCcw,
  Ship,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/Tooltip';
import {
  buildWhatsAppSummary,
  richHtmlToWhatsappMarkdown,
  whatsappMarkdownToHtml,
} from '@/features/quotations/whatsappSummary';

/**
 * WhatsApp message workflow shared by the quotation detail page and the
 * quotations list row actions: generates the summary text with
 * {@link buildWhatsAppSummary} for the given quotation + version, lets the
 * user toggle optional sections and edit freely in a rich editor, and copies
 * WhatsApp-ready text. Pricing stays in the weblink by design.
 */
export function WhatsappSummaryDialog({
  open,
  onClose,
  quotation,
  version,
  weblinkUrl,
  companyName,
  preparedByName,
}: {
  open: boolean;
  onClose: () => void;
  quotation: Parameters<typeof buildWhatsAppSummary>[0]['quotation'];
  version: Parameters<typeof buildWhatsAppSummary>[0]['version'];
  weblinkUrl: string | null;
  companyName: string;
  preparedByName: string | null;
}) {
  const [summaryCopied, setSummaryCopied] = useState(false);
  const summaryCopyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [includeFlights, setIncludeFlights] = useState(false);
  const [includeCruises, setIncludeCruises] = useState(false);
  const [includeVehicles, setIncludeVehicles] = useState(false);
  const [whatsappHtml, setWhatsappHtml] = useState('');
  const whatsappEditorRef = useRef<HTMLDivElement | null>(null);
  const [whatsappResetKey, setWhatsappResetKey] = useState(0);

  const buildHtml = (overrides?: {
    includeFlights?: boolean;
    includeCruises?: boolean;
    includeVehicles?: boolean;
    weblinkUrl?: string | null;
  }) =>
    whatsappMarkdownToHtml(
      buildWhatsAppSummary({
        quotation,
        version,
        weblinkUrl: overrides?.weblinkUrl !== undefined ? overrides.weblinkUrl : weblinkUrl,
        companyName,
        preparedByName,
        options: {
          includeFlights: overrides?.includeFlights ?? includeFlights,
          includeCruises: overrides?.includeCruises ?? includeCruises,
          includeVehicles: overrides?.includeVehicles ?? includeVehicles,
        },
      }),
    );

  // (Re)build the message whenever the dialog opens or its inputs change.
  useEffect(() => {
    if (!open) return;
    setWhatsappHtml(buildHtml());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, includeFlights, includeCruises, includeVehicles, weblinkUrl, quotation, version]);

  // Push generated HTML into the contentEditable DOM (avoids controlled re-render cursor jumps)
  useEffect(() => {
    if (!open) return;
    if (!whatsappEditorRef.current) return;
    if (whatsappEditorRef.current.innerHTML !== whatsappHtml) {
      whatsappEditorRef.current.innerHTML = whatsappHtml;
    }
  }, [whatsappHtml, open]);

  const execRichCommand = (command: string, value?: string) => {
    const editor = whatsappEditorRef.current;
    if (!editor) return;
    editor.focus();
    try {
      document.execCommand(command, false, value);
    } catch {
      // Fallback no-op; toolbar still focuses editor for manual typing.
    }
    // Sync HTML state after command
    setWhatsappHtml(editor.innerHTML);
  };

  const copyWhatsappSummary = async () => {
    const editor = whatsappEditorRef.current;
    // Prefer the live rich HTML from the editor (includes user edits), fallback to stored html
    const html = editor?.innerHTML ?? whatsappHtml;
    const fallbackMarkdown = buildWhatsAppSummary({
      quotation,
      version,
      weblinkUrl,
      companyName,
      preparedByName,
      options: { includeFlights, includeCruises, includeVehicles },
    });
    const text = html ? richHtmlToWhatsappMarkdown(html) : fallbackMarkdown;
    if (!text.trim()) return;
    try {
      await navigator.clipboard.writeText(text);
      setSummaryCopied(true);
      if (summaryCopyTimerRef.current) clearTimeout(summaryCopyTimerRef.current);
      summaryCopyTimerRef.current = setTimeout(() => setSummaryCopied(false), 1800);
    } catch {
      // Copy failed — do not show "Copied!".
    }
  };

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4 backdrop-blur-sm">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="whatsapp-summary-title"
        className="flex max-h-[85vh] w-full max-w-[640px] flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl"
      >
        {/* Header — compact and CRM-aligned */}
        <div className="flex items-start justify-between gap-4 px-6 pt-5 pb-4">
          <div className="flex gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600 ring-1 ring-emerald-100">
              <MessageCircle className="h-5 w-5" />
            </div>
            <div>
              <h2 id="whatsapp-summary-title" className="text-[15px] font-semibold leading-none text-slate-900">
                WhatsApp Message
              </h2>
              <p className="mt-1 text-xs leading-4 text-slate-500">
                Clean share text — pricing stays in the weblink. Edit freely.
              </p>
            </div>
          </div>
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="rounded-full p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Add sections — subtle pill control */}
        <div className="flex items-center gap-2 border-y border-slate-100 bg-slate-50/60 px-6 py-2.5">
          <span className="shrink-0 text-xs font-medium text-slate-500">Add sections</span>
          <div className="flex items-center gap-1.5">
            {[
              { key: 'flights', label: 'Flights', Icon: Plane, active: includeFlights, setter: setIncludeFlights },
              { key: 'cruises', label: 'Cruises', Icon: Ship, active: includeCruises, setter: setIncludeCruises },
              { key: 'vehicles', label: 'Vehicles', Icon: CarFront, active: includeVehicles, setter: setIncludeVehicles },
            ].map(({ key, label, Icon, active, setter }) => (
              <button
                key={key}
                type="button"
                aria-pressed={active}
                onClick={() => (setter as (v: boolean) => void)(!active)}
                className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition ${
                  active
                    ? 'border-slate-900 bg-slate-900 text-white shadow-sm'
                    : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50'
                }`}
              >
                <Icon className="h-3.5 w-3.5" />
                {label}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={() => {
              // Regenerate from current quotation data, discarding manual edits in the editor
              const html = buildHtml();
              // Increment key to force remount and ensure immediate visual update, works repeatedly
              setWhatsappResetKey((k) => k + 1);
              setWhatsappHtml(html);
              // Ensure DOM is updated even if html is same as before (repeated resets)
              requestAnimationFrame(() => {
                if (whatsappEditorRef.current) {
                  whatsappEditorRef.current.innerHTML = html;
                }
              });
            }}
            className="ml-auto inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium text-slate-500 transition hover:bg-white hover:text-slate-700"
            title="Reset to generated default"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            Reset
          </button>
        </div>

        {/* Toolbar — compact, intuitive */}
        <div className="flex items-center gap-1 border-b border-slate-100 bg-white px-3 py-2">
          <button
            type="button"
            title="Bold"
            aria-label="Bold"
            onClick={() => execRichCommand('bold')}
            className="inline-flex h-7 w-7 items-center justify-center rounded-md text-slate-700 hover:bg-slate-100"
          >
            <Bold className="h-4 w-4" />
          </button>
          <button
            type="button"
            title="Italic"
            aria-label="Italic"
            onClick={() => execRichCommand('italic')}
            className="inline-flex h-7 w-7 items-center justify-center rounded-md text-slate-700 hover:bg-slate-100"
          >
            <Italic className="h-4 w-4" />
          </button>
          <div className="mx-1 h-4 w-px bg-slate-200" />
          <button
            type="button"
            title="Bulleted list"
            aria-label="Bulleted list"
            onClick={() => execRichCommand('insertUnorderedList')}
            className="inline-flex h-7 w-7 items-center justify-center rounded-md text-slate-700 hover:bg-slate-100"
          >
            <List className="h-4 w-4" />
          </button>
          <button
            type="button"
            title="Heading"
            aria-label="Heading"
            onClick={() => execRichCommand('formatBlock', '<h3>')}
            className="inline-flex h-7 w-7 items-center justify-center rounded-md text-slate-700 hover:bg-slate-100"
          >
            <Heading1 className="h-4 w-4" />
          </button>
          <span className="ml-auto hidden text-xs text-slate-400 sm:inline">Select text to format</span>
        </div>

        {/* Rich-text editor — shows formatted text, not markdown */}
        <div className="flex-1 overflow-auto bg-[#fcfcfc] p-4">
          <div
            key={whatsappResetKey}
            ref={whatsappEditorRef}
            contentEditable
            suppressContentEditableWarning
            role="textbox"
            aria-multiline="true"
            aria-label="WhatsApp summary editor"
            data-placeholder="Summary will appear here…"
            onInput={(e) => setWhatsappHtml((e.currentTarget as HTMLDivElement).innerHTML)}
            className="rich-text-content min-h-[320px] rounded-xl border border-slate-200 bg-white p-5 text-sm leading-6 text-slate-800 shadow-sm prose prose-sm max-w-none prose-p:my-1.5 prose-headings:mt-6 prose-headings:mb-2 prose-hr:my-5 prose-li:my-1 prose-strong:font-semibold prose-strong:text-slate-900 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-300 [&:empty:before]:content-[attr(data-placeholder)] [&:empty:before]:text-slate-400"
          />
          <p className="mt-3 text-center text-xs text-slate-400">
            Styled for you — bold, bullets and headings are rendered. Copied as WhatsApp-ready text.
          </p>
        </div>

        {/* Footer — cleanly positioned */}
        <div className="flex items-center justify-between gap-3 border-t border-slate-100 bg-white px-6 py-4">
          <span className="text-xs text-slate-400">
            {weblinkUrl ? 'Weblink included' : 'Weblink pending'} • No pricing
          </span>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={onClose} className="text-slate-600">
              Close
            </Button>
            <TooltipProvider delayDuration={0}>
              <Tooltip
                open={summaryCopied}
                onOpenChange={(open) => {
                  if (!open) setSummaryCopied(false);
                }}
              >
                <TooltipTrigger asChild>
                  <Button
                    onClick={() => void copyWhatsappSummary()}
                    className="bg-slate-900 px-5 text-white shadow-sm hover:bg-slate-800"
                  >
                    <Copy className="h-4 w-4" />
                    {summaryCopied ? 'Copied!' : 'Copy'}
                  </Button>
                </TooltipTrigger>
                <TooltipContent>{summaryCopied ? 'Copied!' : 'Copy to clipboard'}</TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
        </div>
      </div>
    </div>
  );
}
