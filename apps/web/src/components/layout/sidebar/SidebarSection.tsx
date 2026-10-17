import type { ReactNode } from 'react';
import { NAV_SECTION_LABELS, type NavSection } from '../navigation';
import { cn } from '@/utils/cn';

interface SidebarSectionProps {
  section: NavSection;
  collapsed: boolean;
  /** First rendered section gets tighter top spacing. */
  isFirst: boolean;
  children: ReactNode;
}

/**
 * One group of navigation items. Headings are intentionally not rendered;
 * groups are separated by spacing alone (a subtle divider on the collapsed
 * rail). The section name stays on the wrapper as an accessible label;
 * empty sections are filtered by the caller.
 */
export function SidebarSection({ section, collapsed, isFirst, children }: SidebarSectionProps) {
  if (collapsed) {
    return (
      <section aria-label={NAV_SECTION_LABELS[section]} className={cn(isFirst ? '' : 'mt-2')}>
        <div className="mx-3 my-2 border-t border-sidebar-border/70" aria-hidden="true" />
        {children}
      </section>
    );
  }

  return (
    <section aria-label={NAV_SECTION_LABELS[section]} className={cn(isFirst ? '' : 'mt-4')}>
      {children}
    </section>
  );
}
