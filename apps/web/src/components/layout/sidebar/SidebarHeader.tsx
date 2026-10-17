import { useState } from 'react';
import { PanelLeftClose, PanelLeftOpen, X } from 'lucide-react';
import { useAuth } from '@/features/auth/AuthProvider';
import { AppLogo } from '@/components/layout/AppLogo';

interface SidebarHeaderProps {
  collapsed: boolean;
  onToggleCollapse: () => void;
  onCloseMobile: () => void;
}

/** Whether the browser is on the authenticated Company's ACTIVE custom domain. */
function isOnCustomDomain(hostname: string | null | undefined): boolean {
  if (!hostname) return false;
  const current = window.location.hostname.trim().toLowerCase().replace(/\.$/, '');
  return current === hostname.trim().toLowerCase().replace(/\.$/, '');
}

/**
 * Brand area: the full product logo in the expanded state, the compact mark
 * on the collapsed rail, and the drawer close control (mobile).
 *
 * The logo always owns the full header width — no toggle sits beside it.
 * The desktop collapse/expand control floats on the sidebar's outer right
 * edge, anchored to the positioned sidebar shell, clear of the logo.
 *
 * When the CRM is accessed through the Company's ACTIVE custom domain, the
 * top-left branding shows that Company's logo + name from Company Settings;
 * otherwise the single full Travel Agency CRM logo asset is shown with no
 * separate product text.
 */
export function SidebarHeader({ collapsed, onToggleCollapse, onCloseMobile }: SidebarHeaderProps) {
  const { user } = useAuth();
  const [companyLogoFailed, setCompanyLogoFailed] = useState(false);
  const company = user?.company;
  const customerBranding = Boolean(company && isOnCustomDomain(company.customDomain?.hostname));
  const logoUrl = customerBranding && !companyLogoFailed ? (company?.logoUrl ?? null) : null;

  const companyMark = logoUrl ? (
    <img
      src={logoUrl}
      alt=""
      className="h-full w-full rounded-lg object-contain"
      onError={() => {
        // A broken Company logo falls back to the platform logo without
        // breaking the shell.
        setCompanyLogoFailed(true);
      }}
    />
  ) : (
    <AppLogo />
  );

  return (
    <div className="relative flex h-14 shrink-0 items-center gap-2.5 border-b border-sidebar-border pl-3 pr-3 lg:pr-5">
      {collapsed ? (
        <div
          className="mx-auto flex h-9 w-9 shrink-0 items-center justify-center rounded-lg lg:mx-0"
          aria-hidden="true"
        >
          {companyMark}
        </div>
      ) : customerBranding && company ? (
        <>
          <div
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg"
            aria-hidden="true"
          >
            {companyMark}
          </div>
          <span
            className="min-w-0 flex-1 truncate text-[15px] font-semibold leading-tight tracking-tight text-sidebar-foreground"
            title={company.name}
          >
            {company.name}
          </span>
        </>
      ) : (
        <img
          src="/new-logo.png"
          alt="Travel Agency CRM"
          className="block h-full w-full min-w-0 flex-1 object-contain object-left"
        />
      )}

      <button
        type="button"
        onClick={onToggleCollapse}
        aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        className="absolute right-0 top-1/2 hidden -translate-y-1/2 translate-x-1/2 rounded-full border border-sidebar-border bg-sidebar p-1.5 text-muted-foreground shadow-sm transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground lg:block"
      >
        {collapsed ? (
          <PanelLeftOpen className="h-[19px] w-[19px]" aria-hidden="true" />
        ) : (
          <PanelLeftClose className="h-[19px] w-[19px]" aria-hidden="true" />
        )}
      </button>

      <button
        type="button"
        onClick={onCloseMobile}
        aria-label="Close navigation"
        className="ml-auto rounded-md p-1.5 text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground lg:hidden"
      >
        <X className="h-5 w-5" aria-hidden="true" />
      </button>
    </div>
  );
}
