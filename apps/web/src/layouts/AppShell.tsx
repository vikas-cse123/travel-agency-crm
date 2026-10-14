import { useCallback, useEffect, useState } from 'react';
import { Outlet, useLocation, useMatch } from 'react-router-dom';
import { cn } from '@/utils/cn';
import { Sidebar } from '@/components/layout/sidebar/Sidebar';
import { useSidebarCollapse } from '@/components/layout/sidebar/sidebar-state';
import { Topbar } from '@/components/layout/Topbar';
import { NAV_ITEMS } from '@/components/layout/navigation';

/**
 * Route pattern that renders the Quotation Builder (editing an existing
 * quotation version). Shared with the route configuration so the sidebar
 * behavior below can never drift from the actual edit route.
 */
export const QUOTATION_BUILDER_EDIT_PATTERN = '/quotations/:quotationId/versions/:versionId/edit';

/** Derive breadcrumbs from the current path, falling back to the raw segment. */
function useBreadcrumbs(): string[] {
  const { pathname } = useLocation();
  const match = NAV_ITEMS.find((item) => pathname.startsWith(item.to));

  if (match) return ['Home', match.label];

  const segment = pathname.split('/').filter(Boolean)[0];
  return segment ? ['Home', segment.charAt(0).toUpperCase() + segment.slice(1)] : ['Home'];
}

/** The authenticated application frame: sidebar, topbar and page outlet. */
export function AppShell() {
  const { collapsed, setCollapsed } = useSidebarCollapse();
  const [mobileOpen, setMobileOpen] = useState(false);
  const breadcrumbs = useBreadcrumbs();
  const onBuilderRoute = useMatch(QUOTATION_BUILDER_EDIT_PATTERN) !== null;
  // Session flag: once the user manually toggles the sidebar while on the
  // builder route, route-forcing yields to their choice until they leave the
  // route. Cleared on exit so the next entry collapses again.
  const [builderManual, setBuilderManual] = useState(false);

  useEffect(() => {
    if (!onBuilderRoute) setBuilderManual(false);
  }, [onBuilderRoute]);

  // Route-forced collapse is derived during render (explicit `true`, never a
  // toggle), so the first paint on the edit page is already collapsed — no
  // expanded-to-collapsed flicker and no repeated forcing on rerenders. The
  // underlying preference state is untouched by the forced value, so the
  // localStorage persistence inside useSidebarCollapse never sees (and never
  // overwrites the saved preference with) the route-specific collapse. Only
  // an explicit manual toggle writes the preference, exactly as before.
  const effectiveCollapsed = onBuilderRoute && !builderManual ? true : collapsed;

  // Manual control always operates on the *visible* state. While the route
  // forces a collapse, the stored preference may still say "expanded", so a
  // plain toggle would flip the hidden preference and appear to do nothing.
  // Setting the negation of the effective state makes the first click while
  // forced always expand, and degrades to an ordinary toggle everywhere else.
  const handleToggleCollapse = useCallback(() => {
    if (onBuilderRoute) setBuilderManual(true);
    setCollapsed(!effectiveCollapsed);
  }, [onBuilderRoute, effectiveCollapsed, setCollapsed]);

  return (
    <div className="min-h-screen bg-background">
      <Sidebar
        collapsed={effectiveCollapsed}
        onToggleCollapse={handleToggleCollapse}
        mobileOpen={mobileOpen}
        onCloseMobile={() => setMobileOpen(false)}
      />

      <div
        className={cn(
          'transition-[padding-left] duration-200 ease-out',
          effectiveCollapsed
            ? 'lg:pl-[var(--sidebar-width-collapsed)]'
            : 'lg:pl-[var(--sidebar-width-expanded)]',
        )}
      >
        <Topbar onOpenMobile={() => setMobileOpen(true)} breadcrumbs={breadcrumbs} />

        <main className="w-full p-4 sm:p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
