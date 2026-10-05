/**
 * Centralized smooth-scroll behaviour for the public quotation weblink.
 *
 * Section headings carry `scroll-margin-top` (SectionTitle) so calling
 * `scrollIntoView({ block: 'start' })` already clears the sticky Jump To bar.
 * `prefers-reduced-motion` is respected everywhere so we never force motion on
 * a customer who has disabled it.
 */

export function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

/** Smoothly scroll to a section heading by its stable anchor id. */
export function scrollToSectionId(id: string): void {
  const el = document.getElementById(id);
  if (!el) return;
  el.scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth', block: 'start' });
}

/** Smoothly scroll the window back to the very top. */
export function scrollToTop(): void {
  window.scrollTo({
    top: 0,
    behavior: prefersReducedMotion() ? 'auto' : 'smooth',
  });
}

/**
 * Trigger line for the weblink scroll-spy, just below the sticky Jump To
 * bar. Section headings land on this line after an anchor scroll because
 * they all carry the same scroll-margin-top (see SectionTitle).
 */
export const SCROLL_SPY_TRIGGER_OFFSET = 100;

export interface ScrollSpyViewport {
  scrollY: number;
  innerHeight: number;
  documentHeight: number;
}

/**
 * Centralized active-section detection for the public quotation weblink.
 * Always resolves exactly one section id (or '' when there are no sections),
 * so two navigation items can never be green at the same time:
 *
 * - The active section is the last heading at or above the trigger line, so
 *   manual scrolling naturally moves the green state between sections in
 *   both directions.
 * - When the viewport reaches the bottom of the page the last section wins,
 *   even if its heading rests below the trigger line. Short trailing
 *   sections such as Contact Us can never scroll fully under the sticky bar,
 *   so without this the previous section would incorrectly stay active.
 */
export function activeScrollSpyId(
  sections: Array<{ id: string }>,
  headingTop: (id: string) => number | null,
  viewport: ScrollSpyViewport,
): string {
  const first = sections[0];
  const last = sections[sections.length - 1];
  if (!first || !last) return '';
  if (viewport.innerHeight + viewport.scrollY >= viewport.documentHeight - 2) return last.id;
  let current = first.id;
  for (const section of sections) {
    const top = headingTop(section.id);
    if (top === null) continue;
    if (top <= SCROLL_SPY_TRIGGER_OFFSET) current = section.id;
    else break;
  }
  return current;
}