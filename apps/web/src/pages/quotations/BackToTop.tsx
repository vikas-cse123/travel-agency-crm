import { useEffect, useRef, useState } from 'react';
import { ArrowUp } from 'lucide-react';
import { scrollToTop } from './scroll';

/** Fraction of the scrollable document the visitor must pass before showing. */
const SCROLL_THRESHOLD = 0.4;

/**
 * Floating "Back to top" button for the public quotation weblink.
 *
 * Fixed to the bottom-right, hidden until the visitor has scrolled through at
 * least 40% of the total scrollable document (scrollTop / (scrollHeight -
 * clientHeight) >= 0.4), then fades/slides in. Hides again when scrolling back
 * above the threshold. Smooth-scrolls to the top on click. Uses the quotation
 * green theme with a soft rounded-square shape and a subtle shadow. Positioning
 * is fixed, so it never causes layout shift.
 *
 * The same component is portalled into the live-preview phone iframe, where the
 * scrolling container is the frame's own document. It therefore drives the
 * window that actually owns its DOM (`ownerDocument.defaultView`) — the frame
 * window in the preview, the top window on the real weblink — instead of the
 * global `window`, so it becomes visible and scrolls the right container in
 * both places.
 */
export function BackToTop() {
  const [visible, setVisible] = useState(false);
  const buttonRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    const win = buttonRef.current?.ownerDocument?.defaultView ?? window;
    const doc = win.document;
    const onScroll = () => {
      const root = doc.documentElement;
      const scrollable = root.scrollHeight - root.clientHeight;
      const ratio = scrollable > 0 ? win.scrollY / scrollable : 0;
      setVisible(ratio >= SCROLL_THRESHOLD);
    };
    onScroll();
    win.addEventListener('scroll', onScroll, { passive: true });
    return () => win.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <button
      ref={buttonRef}
      type="button"
      aria-label="Back to top"
      onClick={() => {
        const win = buttonRef.current?.ownerDocument?.defaultView ?? window;
        scrollToTop(win);
      }}
      className={[
        'fixed z-40 flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-600 text-white shadow-lg transition-all duration-300',
        'right-4 bottom-4 sm:right-6 sm:bottom-6',
        'bottom-[calc(1rem+env(safe-area-inset-bottom))] sm:bottom-[calc(1.5rem+env(safe-area-inset-bottom))]',
        'hover:-translate-y-0.5 hover:bg-emerald-700 hover:shadow-xl',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2',
        visible ? 'translate-y-0 opacity-100' : 'pointer-events-none translate-y-2 opacity-0',
      ].join(' ')}
    >
      <ArrowUp className="h-5 w-5" aria-hidden="true" />
    </button>
  );
}