import { ExternalLink } from 'lucide-react';
import { cn } from '@/utils/cn';
import { WHATSAPP_CRM_URL } from '../navigation';

/**
 * Cross-app launcher to the sister product, WhatsApp Max.
 *
 * A clean white tile with a subtle border and rounded corners, matching the
 * product-switcher pattern used in WhatsApp Max itself: logo on the left,
 * product name plus an external-link mark. Because WhatsApp Max is a separate
 * application on its own domain, this is a plain external anchor that opens
 * in a new tab (never a router link), with `rel="noopener noreferrer"` so the
 * opened tab cannot reach back into this one. It matches the collapsed-rail
 * behaviour of the nav items: the label is hidden on the collapsed desktop
 * rail but kept for the mobile drawer, and the accessible name is always
 * present via `aria-label`.
 */
export function SidebarAppSwitcher({ collapsed }: { collapsed: boolean }) {
  return (
    <div className="border-t border-sidebar-border px-2.5 py-3">
      <a
        href={WHATSAPP_CRM_URL}
        target="_blank"
        rel="noopener noreferrer"
        aria-label="Open WhatsApp Max in a new tab"
        title="Open WhatsApp Max in a new tab"
        className={cn(
          'flex h-10 items-center gap-2.5 rounded-lg border border-slate-200 bg-white px-2.5 text-[13px] font-medium text-blue-600 transition-colors duration-150 hover:bg-slate-50',
          collapsed && 'lg:justify-center',
        )}
      >
        <img
          src="/whatsappmax.webp"
          alt=""
          aria-hidden="true"
          className="h-6 w-6 shrink-0 rounded-md object-contain"
        />
        <span className={cn('flex min-w-0 flex-1 items-center gap-1', collapsed && 'lg:hidden')}>
          <span className="truncate">WhatsApp Max</span>
          <ExternalLink className="h-3.5 w-3.5 shrink-0 text-blue-500" aria-hidden="true" />
        </span>
      </a>
    </div>
  );
}
