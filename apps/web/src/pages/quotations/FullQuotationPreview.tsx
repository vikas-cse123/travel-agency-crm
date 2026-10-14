import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useWatch, type Control } from 'react-hook-form';
import { X } from 'lucide-react';
import type { ManagedUser, QuotationVersionInput } from '@interscale/shared';
import type {
  Quotation,
  QuotationVersion,
} from '@/features/quotations/quotations.api';
import type { CompanySettings } from '@/features/settings/settings.api';
import { PublicQuotationView, type PublicQuotation } from './PublicQuotationPage';
import {
  EMPTY_PREVIEW_PRESENTATIONS,
  usePreviewPresentations,
  type PreviewMasterLists,
  type PreviewPresentations,
} from './PreviewPresentations';

/**
 * Position a scroll container at a preview section anchor once. Scrolls only
 * the given container (never the page or window); a small offset keeps the
 * heading clear of the container top. Missing sections fall back to the top.
 * The container may be an inline scroll div or a preview iframe's scrolling
 * root — both expose the same query/scroll interface. Pure DOM helper,
 * exported for focused tests.
 *
 * Root-scroller awareness: a document's scrolling root reports its own rect
 * relative to the viewport (`top === -scrollTop`), so the generic
 * anchor-minus-container math would count the current scroll twice. When the
 * container is its document's scrolling root, the anchor's viewport position
 * already accounts for scrolling and is applied directly.
 */
export function scrollPreviewToSection(
  container: HTMLElement | null,
  sectionId: string | null,
): void {
  scrollPreviewToTarget(container, { section: sectionId, items: [] });
}

/**
 * Item-level preview target: the public section plus ordered item candidates
 * within it. Item values match `data-preview-item` attributes stamped on the
 * public quotation elements (never user-visible):
 * - `day:<n>` — sightseeing day at form position n (days have no stable ids;
 *   the public itinerary renders the same array order, so positions map
 *   exactly across reorder/add/remove; invalid days are skipped by matching
 *   the stamped source index, not the rendered position).
 * - `hotel:<n>` — hotel stay at form position n (form values carry no stable
 *   row ids; same-order arrays on both sides keep positions exact).
 * - `flight:<leg key>` — flight journey leg (`flight-<record>-outbound` /
 *   `-return`), stable per record position like the others.
 *
 * Sections without a per-item selection affordance in the builder (cruise,
 * vehicle, add-ons, FAQs, inclusions) use an empty item list: section-level
 * navigation only.
 */
export interface PreviewTarget {
  section: string | null;
  items: string[];
}

/** Stable string key for a target: effect deps on this never fire on keystrokes. */
export function previewTargetKey(target: PreviewTarget | null | undefined): string {
  if (!target) return '';
  return `${target.section ?? ''}\n${(target.items ?? []).join(',')}`;
}

/**
 * Position a scroll container at a preview target once: the first matching
 * item candidate wins, else the section anchor, else the top (existing
 * fallback behavior). Scrolls only the given container (never the page or
 * window); a small offset keeps the heading clear of the container top.
 * Pure DOM helper, exported for focused tests. See `scrollPreviewToSection`
 * for the root-scroller math notes (shared below).
 */
export function scrollPreviewToTarget(
  container: HTMLElement | null,
  target: PreviewTarget | null | undefined,
): void {
  if (!container) return;
  // NOTE: lookup runs through the container itself, which lives inside the
  // preview iframe's document when portalled — never the parent application
  // document. Item values are builder-generated (`day:<n>` etc.).
  const items = target?.items ?? [];
  let anchor: HTMLElement | null = null;
  for (const item of items) {
    if (!item) continue;
    anchor = container.querySelector<HTMLElement>(`[data-preview-item="${item}"]`);
    if (anchor) break;
  }
  if (!anchor && target?.section) {
    anchor =
      container.querySelector<HTMLElement>(`[data-preview-section="${target.section}"]`);
  }
  if (!anchor) {
    container.scrollTop = 0;
    return;
  }
  const doc = container.ownerDocument ?? null;
  const isRootScroller =
    !!doc && (container === doc.scrollingElement || container === doc.documentElement);
  const anchorTop = anchor.getBoundingClientRect().top;
  const top = isRootScroller
    ? container.scrollTop + anchorTop - 16
    : anchorTop -
      container.getBoundingClientRect().top +
      container.scrollTop -
      16;
  container.scrollTop = Math.max(0, top);
}

/**
 * iQOO Neo9 Pro device configuration, shared by both preview modes.
 *
 * Official specs (https://www.iqoo.com/in/products/neo9pro):
 * - Physical body: 163.53 mm high × 75.68 mm wide
 * - Display: 6.78 in diagonal, 1260 × 2800 px, 9:20 aspect ratio
 *
 * The iframe's internal CSS viewport (393 × 873.33) is a practical emulation
 * size preserving the exact 9:20 screen ratio — not a claim about the phone's
 * Android-reported logical resolution. It stays fixed: visual scaling uses a
 * CSS transform on the device frame and never changes this layout viewport,
 * so Tailwind `sm:`/`md:`/`lg:` breakpoints evaluate exactly as on a phone.
 *
 * The outer body (417 × ~901.06) preserves the physical 75.68:163.53 ratio:
 * a 393px screen plus 12px side bezels gives a 417px body, and the body
 * height follows from the physical ratio. Bezels account for the difference
 * between the 9:20 display and the physical body ratio — the two ratios are
 * intentionally not identical.
 */
export const MOBILE_PREVIEW_WIDTH = 393;
export const MOBILE_PREVIEW_HEIGHT = 873.33;
export const PHONE_BODY_WIDTH_MM = 75.68;
export const PHONE_BODY_HEIGHT_MM = 163.53;
/** Outer body width: screen width plus 12px bezels on each side. */
export const PHONE_BODY_WIDTH = MOBILE_PREVIEW_WIDTH + 24;
/** Outer body height derived from the physical 75.68:163.53 ratio. */
export const PHONE_BODY_HEIGHT =
  (PHONE_BODY_WIDTH * PHONE_BODY_HEIGHT_MM) / PHONE_BODY_WIDTH_MM;
export const PHONE_BODY_ASPECT_RATIO = `${PHONE_BODY_WIDTH_MM} / ${PHONE_BODY_HEIGHT_MM}`;
export const PHONE_SCREEN_ASPECT_RATIO = '9 / 20';

/**
 * Scrollbar-hiding rules injected into the preview iframe document only —
 * never the desktop page and never the real public weblink (which renders
 * without this style element). Scrolling stays fully enabled (wheel, touch,
 * trackpad, keyboard, programmatic `scrollTop`); only the visible scrollbar
 * chrome is removed. Sticky navigation and section anchors keep working
 * because the scrolling element itself is untouched.
 */
const PREVIEW_SCROLLBAR_CSS = [
  'html{scrollbar-width:none!important;-ms-overflow-style:none!important}',
  'html::-webkit-scrollbar,body::-webkit-scrollbar,#mobile-preview-root::-webkit-scrollbar{display:none!important;width:0!important;height:0!important}',
  'html,body{overscroll-behavior:contain}',
].join('\n');

/**
 * Prepare the preview iframe's document and return the element the shared
 * public renderer should be portalled into (null until ready). The frame is a
 * same-origin `about:blank` document, so the live React tree (with all app
 * context) renders inside it via portal and keeps updating with form state —
 * no refetch, no publish, no second page. Setup is idempotent (StrictMode
 * mounts effects twice) and clones the application's own stylesheets so
 * Tailwind breakpoints, fonts, and assets resolve exactly as on the weblink.
 */
function usePreviewFrameDocument(iframeRef: React.RefObject<HTMLIFrameElement | null>) {
  const [mountNode, setMountNode] = useState<HTMLElement | null>(null);

  useEffect(() => {
    const iframe = iframeRef.current;
    const doc = iframe?.contentDocument;
    if (!iframe || !doc) return;
    // A bare about:blank frame has no doctype, so it renders in quirks mode
    // (BackCompat) — where position:sticky and other modern CSS the weblink
    // relies on do not engage. Rewrite it as a standards-mode document first
    // so the preview matches the real weblink exactly.
    if (doc.compatMode !== 'CSS1Compat') {
      doc.open();
      doc.write('<!DOCTYPE html><html><head></head><body></body></html>');
      doc.close();
    }
    let mount = doc.getElementById('mobile-preview-root');
    if (!mount) {
      const meta = doc.createElement('meta');
      meta.setAttribute('name', 'viewport');
      meta.setAttribute('content', `width=${MOBILE_PREVIEW_WIDTH}, initial-scale=1`);
      doc.head.appendChild(meta);
      // Relative asset URLs (e.g. `/destination-expert/male.png`) resolve
      // against the app origin inside the blank frame document.
      const base = doc.createElement('base');
      base.setAttribute('href', `${window.location.origin}/`);
      doc.head.appendChild(base);
      document.head
        .querySelectorAll('style, link[rel="stylesheet"]')
        .forEach((node) => doc.head.appendChild(node.cloneNode(true)));
      // Hide the scrollbar chrome inside the phone screen; scrolling itself
      // stays enabled. Scoped to this frame document only.
      const scrollbarStyle = doc.createElement('style');
      scrollbarStyle.setAttribute('id', 'mobile-preview-scrollbar');
      scrollbarStyle.textContent = PREVIEW_SCROLLBAR_CSS;
      doc.head.appendChild(scrollbarStyle);
      doc.title = 'Mobile quotation preview';
      mount = doc.createElement('div');
      mount.setAttribute('id', 'mobile-preview-root');
      doc.body.appendChild(mount);
    }
    setMountNode(mount as HTMLElement);
    return () => setMountNode(null);
  }, [iframeRef]);

  return mountNode;
}

/** Ignore sub-pixel scale churn. */
const PHONE_FIT_EPS = 0.001;

/**
 * Uniform visual scale so the complete iQOO Neo9 Pro frame fits the available
 * preview area. The scale depends **only** on the constrained device-area
 * container's own dimensions (`clientWidth`/`clientHeight`) — never on the
 * area's position in the document (`getBoundingClientRect().top`),
 * `window.scrollY`, or any other scroll-dependent value. The chain above the
 * area is viewport-bounded (sticky/fixed panel with `min-height: 0` at every
 * flex level), so the box is truthful; deriving from it keeps the phone
 * stationary relative to its panel: scrolling the desktop page or the
 * quotation inside the phone can never grow, shrink, or shift the device.
 * Only a real change to the area's size (window resize, panel layout change)
 * recalculates the scale, via ResizeObserver plus a window resize listener.
 *
 * A single factor `min(1, availW / bodyW, availH / bodyH)` drives a CSS
 * transform, so the result can never exceed the device-area dimensions; the
 * iframe's internal 393 × 873.33 layout viewport never changes, only its
 * on-screen size.
 *
 * `measured` stays false until a real non-zero measurement lands: the caller
 * keeps the unmeasured phone hidden so the initial scale-1 paint can never
 * show a frame extending past the panel (or force page scroll) on short
 * laptop viewports. Resizing never remounts the iframe, so its scroll
 * position survives scale changes.
 */
function usePhoneFitScale() {
  const areaRef = useRef<HTMLDivElement | null>(null);
  const [scale, setScale] = useState(1);
  const [measured, setMeasured] = useState(false);

  useEffect(() => {
    const el = areaRef.current;
    if (!el) return;
    const compute = () => {
      const availW = el.clientWidth;
      const availH = el.clientHeight;
      if (!availW || !availH) return;
      const next = Math.min(1, availW / PHONE_BODY_WIDTH, availH / PHONE_BODY_HEIGHT);
      setScale((prev) => (Math.abs(prev - next) < PHONE_FIT_EPS ? prev : next));
      setMeasured(true);
    };
    compute();
    window.addEventListener('resize', compute);
    if (typeof ResizeObserver === 'undefined') {
      return () => window.removeEventListener('resize', compute);
    }
    const ro = new ResizeObserver(compute);
    ro.observe(el);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', compute);
    };
  }, []);

  return { areaRef, scale, measured };
}

/**
 * The complete customer-facing public quotation inside a realistic mobile
 * phone frame for the persistent live preview. Renders the
 * actual `PublicQuotationView` (same component, same styles, same data) into
 * a real 393px iframe viewport, so responsive breakpoints behave exactly as
 * on a customer's phone. The phone screen scrolls independently; an optional
 * `activeSection` navigates the frame to a public section whenever it changes
 * (e.g. builder tab switches) — live edits that keep the same section never
 * move it. Read-only: no saves, no finalizes, no published records.
 */
export function MobilePhonePreview({
  data,
  activeSection,
  activeItems,
  frameTestId,
}: {
  data: PublicQuotation;
  /**
   * Public section to show (`data-preview-section` id). Navigates whenever
   * the value changes; null/undefined means "leave the scroll position alone"
   * (used for builder tabs with no corresponding public section).
   */
  activeSection?: string | null;
  /**
   * Item candidates within the section (`data-preview-item` values, tried in
   * order before falling back to the section). Navigates whenever the
   * section/item combination changes; live edits that keep the same target
   * never move it, so typing cannot reset the reader's scroll position.
   */
  activeItems?: string[] | null;
  /** Test id for the iframe element itself. */
  frameTestId: string;
}) {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const mountNode = usePreviewFrameDocument(iframeRef);
  const { areaRef, scale, measured } = usePhoneFitScale();
  // String key: the effect below must fire only when the intended target
  // changes — never on keystrokes (which re-render with new form objects but
  // an identical section/item combination).
  const targetKey = `${activeSection ?? ''}\n${(activeItems ?? []).join(',')}`;

  // Navigate inside the phone viewport when the requested target changes.
  // One coordinated lookup (first matching item, else section, else top) and
  // a single scroll: no section-then-item double jump. Scrolls only the frame
  // (never the builder page or window); a missing or not-yet-rendered target
  // retries briefly, then falls back gracefully. The iframe element itself is
  // never recreated and form data is untouched.
  useEffect(() => {
    if (!mountNode || (activeSection == null && !(activeItems ?? []).length)) return;
    const target: PreviewTarget = { section: activeSection ?? null, items: activeItems ?? [] };
    let cancelled = false;
    let attempts = 0;
    const timers: Array<ReturnType<typeof setTimeout>> = [];
    const tryScroll = (): boolean => {
      if (cancelled) return true;
      const doc = iframeRef.current?.contentDocument;
      const scroller = (doc?.scrollingElement ?? doc?.documentElement ?? null) as
        | HTMLElement
        | null;
      if (!scroller) return false;
      const hasTarget =
        (target.items ?? []).some(
          (item) => item && !!doc?.querySelector<HTMLElement>(`[data-preview-item="${item}"]`),
        ) ||
        (target.section
          ? !!doc?.querySelector<HTMLElement>(`[data-preview-section="${target.section}"]`)
          : false);
      if (!hasTarget && attempts < 5) {
        attempts += 1;
        timers.push(setTimeout(tryScroll, 120));
        return false;
      }
      scrollPreviewToTarget(scroller, target);
      return true;
    };
    tryScroll();
    return () => {
      cancelled = true;
      timers.forEach((timer) => clearTimeout(timer));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mountNode, targetKey]);

  return (
    <div
      data-testid="mobile-phone-frame"
      className="flex min-h-0 w-full flex-1 flex-col items-center overflow-hidden bg-slate-200 px-4 py-4"
    >
      <div
        ref={areaRef}
        className="flex min-h-0 w-full flex-1 items-center justify-center overflow-hidden"
      >
        {/* Layout box at the scaled size keeps the device centered without
            clipping or page scroll; the inner frame renders at full device
            size and is only visually scaled, so the iframe viewport is
            unaffected. Hidden until the first real measurement so an
            unscaled paint can never overflow the visible panel. */}
        <div
          data-testid="mobile-phone-fit"
          style={{
            width: PHONE_BODY_WIDTH * scale,
            height: PHONE_BODY_HEIGHT * scale,
            position: 'relative',
            flexShrink: 0,
            visibility: measured ? 'visible' : 'hidden',
          }}
        >
          <div
            data-testid="mobile-phone-body"
            style={{
              width: PHONE_BODY_WIDTH,
              height: PHONE_BODY_HEIGHT,
              aspectRatio: PHONE_BODY_ASPECT_RATIO,
              transform: `scale(${scale})`,
              transformOrigin: 'top left',
              position: 'absolute',
              top: 0,
              left: 0,
            }}
            className="flex items-center justify-center rounded-[2rem] border border-neutral-800 bg-neutral-900 shadow-lg"
          >
            <div
              data-testid="mobile-phone-screen"
              style={{
                width: MOBILE_PREVIEW_WIDTH,
                height: MOBILE_PREVIEW_HEIGHT,
                aspectRatio: PHONE_SCREEN_ASPECT_RATIO,
              }}
              className="overflow-hidden rounded-[1.4rem] bg-white"
            >
              <iframe
                ref={iframeRef}
                title="Mobile quotation preview"
                data-testid={frameTestId}
                style={{ width: MOBILE_PREVIEW_WIDTH, height: MOBILE_PREVIEW_HEIGHT }}
                className="border-0 bg-white"
              />
            </div>
          </div>
        </div>
      </div>
      {mountNode ? createPortal(<PublicQuotationView data={data} />, mountNode) : null}
    </div>
  );
}
/**
 * Builder sub-tab key → public preview section anchor. Tabs without a
 * matching customer-facing section resolve to null (preview opens at top).
 */
export function previewSectionForBuilderTab(tab: string | null | undefined): string | null {
  switch (tab) {
    case 'pricingMethod':
    case 'summary':
      return 'pricing';
    case 'flight':
      return 'flights';
    case 'hotel':
      return 'hotels';
    case 'sightseeing':
      return 'itinerary';
    case 'cruise':
      return 'cruise';
    case 'vehicle':
      return 'transportation';
    case 'addon':
      return 'addons';
    case 'inclusions':
      return 'policies';
    case 'faqs':
      return 'faqs';
    default:
      return null;
  }
}

/**
 * Destination names for the preview hero, mirroring the server rule: the lead
 * itinerary's country values in first-seen order, de-duplicated; the
 * destination summary only when no country value exists.
 */
export function previewDestinations(
  itinerary: Array<{ country?: string | null }> | null | undefined,
  destinationSummary: string | null | undefined,
): string {
  const seen = new Set<string>();
  const names: string[] = [];
  for (const row of itinerary ?? []) {
    const country = (row?.country ?? '').trim();
    if (!country || seen.has(country.toLowerCase())) continue;
    seen.add(country.toLowerCase());
    names.push(country);
  }
  if (names.length) return names.join(' → ');
  return (destinationSummary ?? '').trim();
}

/** Total package nights from the lead itinerary rows, like the server. */
export function previewDurationNights(
  itinerary: Array<{ nights?: number | null }> | null | undefined,
): number | null {
  const total = (itinerary ?? []).reduce(
    (sum, row) => sum + Math.max(0, Number(row?.nights ?? 0)),
    0,
  );
  return total > 0 ? total : null;
}

type DestinationExpertPreview = NonNullable<PublicQuotation['destinationExpert']>;

/**
 * Build the destination-expert presentation for the live preview, mirroring
 * the server's `resolveDestinationExpertPresentation` with client-available
 * data: the live form's `destinationExpertConfig` (snapshot edits win, exactly
 * like the server), the already-loaded team-member list (no extra fetch), and
 * the company profile contacts as fallback. Returns null under the same
 * conditions the server returns none (disabled, no expert, unknown user), so
 * the preview section appears exactly when the weblink would show it.
 *
 * Avatar priority matches the server: snapshot custom photo, then the team
 * member's confirmed photo URL, then the gender default (the renderer maps it
 * to `/destination-expert/male.png|female.png`, resolved by the frame's base
 * tag), then no avatar (initials fallback).
 */
export function buildDestinationExpertPreview(input: {
  config: QuotationVersionInput['destinationExpertConfig'];
  users: ManagedUser[] | null | undefined;
  companyPhone?: string | null | undefined;
  companyEmail?: string | null | undefined;
}): DestinationExpertPreview | null {
  const { config, users, companyPhone, companyEmail } = input;
  const cfg = (config ?? null) as Record<string, unknown> | null;
  const expertUserId = typeof cfg?.expertUserId === 'string' ? cfg.expertUserId : null;
  if (!cfg || cfg.enabled !== true || !expertUserId) return null;
  const user = (users ?? []).find((member) => member.id === expertUserId) as
    | (ManagedUser & Record<string, unknown>)
    | undefined;
  if (!user) return null;
  const snapText = (value: unknown): string | null =>
    typeof value === 'string' ? value.trim() || null : ((value as string | null) ?? null);
  const snapNumber = (value: unknown): number | null =>
    value == null || value === '' ? null : Number(value);
  const jobTitle = snapText(cfg.jobTitle) ?? user.jobTitle ?? null;
  const bio = snapText(cfg.bio) ?? user.bio ?? null;
  const specialization = snapText(cfg.specialization) ?? user.specialization ?? null;
  const yearsOfExperience = snapNumber(cfg.yearsOfExperience) ?? user.yearsOfExperience ?? null;
  const tripsPlanned = snapNumber(cfg.tripsPlanned) ?? user.tripsPlanned ?? null;
  const languages = snapText(cfg.languages) ?? user.languages ?? null;
  const gender =
    cfg.gender === 'MALE' || cfg.gender === 'FEMALE'
      ? cfg.gender
      : ((user.gender as string | null | undefined) ?? null);
  // Avatar priority: snapshot custom photo > member photo URL > gender default.
  const snapProfileImageUrl =
    'profileImageUrl' in cfg && typeof cfg.profileImageUrl === 'string' && cfg.profileImageUrl.trim()
      ? cfg.profileImageUrl.trim()
      : null;
  let profileImageUrl: string | null = null;
  let avatarKind: 'custom' | 'male' | 'female' | null = null;
  if (snapProfileImageUrl) {
    profileImageUrl = snapProfileImageUrl;
    avatarKind = 'custom';
  } else if (typeof user.profileImageUrl === 'string' && user.profileImageUrl.trim()) {
    profileImageUrl = user.profileImageUrl.trim();
    avatarKind = 'custom';
  }
  if (!profileImageUrl) {
    if (gender === 'MALE') avatarKind = 'male';
    else if (gender === 'FEMALE') avatarKind = 'female';
  }
  // Per-quotation contact overrides (snapshot), mirroring the server: a key
  // holding undefined means an old quotation without the field → fall back to
  // member, then company data. Null/empty means explicit empty → hide.
  const userWhatsapp =
    (typeof user.whatsappNumber === 'string' && user.whatsappNumber.trim()) ||
    (typeof user.phone === 'string' && user.phone.trim()) ||
    null;
  const whatsappNumber =
    cfg.whatsappNumber !== undefined
      ? snapText(cfg.whatsappNumber)
      : userWhatsapp || (companyPhone?.trim() || null);
  const phone =
    cfg.callNumber !== undefined
      ? snapText(cfg.callNumber)
      : ((typeof user.phone === 'string' && user.phone.trim()) || null) ||
        (companyPhone?.trim() || null);
  const email =
    cfg.email !== undefined
      ? (snapText(cfg.email)?.toLowerCase() ?? null)
      : ((typeof user.email === 'string' && user.email.trim()) || null) ||
        (companyEmail?.trim().toLowerCase() || null);
  return {
    id: user.id,
    fullName: user.fullName,
    email,
    phone,
    whatsappNumber,
    jobTitle,
    bio,
    specialization,
    yearsOfExperience,
    tripsPlanned,
    languages,
    gender,
    profileImageUrl,
    avatarKind,
    config: {
      heading: snapText(cfg.heading),
      customIntroduction: snapText(cfg.customIntroduction),
      showWhatsapp: cfg.showWhatsapp !== false,
      showCall: cfg.showCall !== false,
      showEmail: cfg.showEmail !== false,
      showExperience: cfg.showExperience !== false,
      showTripsPlanned: cfg.showTripsPlanned !== false,
      showLanguages: cfg.showLanguages !== false,
    },
  };
}

/**
 * Convert the builder's saved quotation, the version being edited, live
 * (possibly unsaved) form values, company settings, and uploaded-image URLs
 * into the exact data shape the public weblink renders. Pure: never saves,
 * never fetches, never mutates its inputs.
 *
 * Master-sourced presentation data (destination hero image, hotel/cruise/
 * vehicle/sightseeing imagery, hotel ratings and review links) arrives via
 * `presentations`, resolved by `usePreviewPresentations` from the builder's
 * already-loaded masters plus cache-first download-URL queries — the same
 * values the server bakes into the real weblink payload. Sightseeing
 * quotation-document images arrive via `sightseeingPreviewUrls` (document id
 * → inline URL), mirroring the flight-image prop. The destination-expert
 * section resolves from the live form config plus the already-loaded team
 * list (`expertUsers`) via `buildDestinationExpertPreview`, mirroring the
 * server rule (snapshot edits win; null exactly when the weblink omits it).
 * Omitting any of these keeps the previous behavior (placeholders/omissions
 * exactly like a weblink whose server found no data).
 *
 * Known preview gap (server-resolved data with no form equivalent):
 * the PDF download button.
 */
export function buildFullPreviewData(input: {
  quotation: Quotation;
  /** The version row currently being edited (never a different version). */
  savedVersion: QuotationVersion;
  /** Live form values across every builder tab. */
  form: QuotationVersionInput;
  settings?: CompanySettings | null | undefined;
  /** Uploaded flight-image URLs keyed by document id. */
  flightPreviewUrls: Record<string, string>;
  /** Master-sourced presentations; defaults to empty (previous behavior). */
  presentations?: PreviewPresentations | null | undefined;
  /** Uploaded sightseeing-document image URLs keyed by document id. */
  sightseeingPreviewUrls?: Record<string, string> | null | undefined;
  /** Already-loaded team members for the destination-expert preview. */
  expertUsers?: ManagedUser[] | null | undefined;
}): PublicQuotation {
  const {
    quotation,
    savedVersion,
    form,
    settings,
    flightPreviewUrls,
    presentations,
    sightseeingPreviewUrls,
    expertUsers,
  } = input;
  const profile = settings?.profile;
  const branding = settings?.branding;
  const tax = settings?.tax;
  const query = ((quotation as { query?: unknown }).query ?? {}) as Quotation['query'] & {
    itinerary?: Array<{
      country: string;
      destination: string;
      nights: number;
    }> | null;
  };
  const quotationSummary =
    (quotation as { destinationSummary?: string | null }).destinationSummary ?? '';
  const extra = quotation as Quotation & {
    childrenWithBedAges?: number[] | null;
    childrenWithoutBedAges?: number[] | null;
    infantAges?: number[] | null;
  };
  const flightImages =
    form.flightDetails?.entryMode === 'IMAGE'
      ? (form.flightDetails?.images ?? []).flatMap((image) => {
          const url = image?.documentId ? flightPreviewUrls[image.documentId] : undefined;
          return url ? [{ url, description: image.description ?? null }] : [];
        })
      : [];
  const resolved = presentations ?? EMPTY_PREVIEW_PRESENTATIONS;
  // Sightseeing quotation-document images mirror the server mapping
  // (document id → inline URL); entries without a resolved URL behave
  // exactly like a weblink whose server found no document.
  const sightseeingDocumentPresentations: Record<string, { imageUrl: string | null }> = {};
  for (const [documentId, url] of Object.entries(sightseeingPreviewUrls ?? {})) {
    if (url) sightseeingDocumentPresentations[documentId] = { imageUrl: url };
  }
  return {
    company: {
      name: profile?.name ?? '',
      email: profile?.email ?? '',
      phone: profile?.phone ?? null,
      website: profile?.website ?? null,
      address: profile?.address ?? null,
      googleMapsUrl: profile?.googleMapsUrl ?? null,
      primaryColor: branding?.primaryColor ?? '#2563eb',
      operatingSince: profile?.operatingSince ?? null,
      tripsSold: profile?.tripsSold ?? null,
      tan: tax?.tan ?? null,
      taxRegistrationNumber: tax?.taxRegistrationNumber ?? null,
      logoUrl: branding?.logoUrl ?? null,
    },
    quotation: {
      quotationNumber: (quotation as { quotationNumber?: string }).quotationNumber ?? '',
      customerName: (quotation as { customerName?: string }).customerName ?? '',
      destinationSummary: quotationSummary,
      destinations: previewDestinations(query?.itinerary ?? null, quotationSummary),
      durationNights: previewDurationNights(query?.itinerary ?? null),
      travelStartDate: (quotation as { travelStartDate?: string | null }).travelStartDate ?? null,
      travelEndDate: (quotation as { travelEndDate?: string | null }).travelEndDate ?? null,
      adults: (quotation as { adults?: number }).adults ?? 0,
      childrenWithBed: (quotation as { childrenWithBed?: number }).childrenWithBed ?? 0,
      childrenWithoutBed: (quotation as { childrenWithoutBed?: number }).childrenWithoutBed ?? 0,
      infants: (quotation as { infants?: number }).infants ?? 0,
      rooms: (quotation as { rooms?: number }).rooms ?? 0,
      childrenWithBedAges: extra.childrenWithBedAges ?? null,
      childrenWithoutBedAges: extra.childrenWithoutBedAges ?? null,
      infantAges: extra.infantAges ?? null,
      createdAt: (quotation as { createdAt?: string }).createdAt ?? new Date(0).toISOString(),
    },
    // Live form values win over the saved row everywhere the builder edits;
    // identity, lifecycle, and attribution stay with the saved version.
    version: {
      ...savedVersion,
      ...form,
    } as unknown as QuotationVersion,
    heroImageUrl: resolved.heroImageUrl,
    hotelPresentations: resolved.hotelPresentations,
    vehiclePresentations: resolved.vehiclePresentations,
    airlinePresentations: resolved.airlinePresentations,
    flightImages,
    flightImageUrl: null,
    sightseeingPresentations: resolved.sightseeingPresentations,
    sightseeingDocumentPresentations,
    cruisePresentations: resolved.cruisePresentations,
    destinationExpert: buildDestinationExpertPreview({
      config: form.destinationExpertConfig,
      users: expertUsers,
      companyPhone: profile?.phone,
      companyEmail: profile?.email,
    }),
    downloadUrl: null,
  };
}

/**
 * Shared live subscription + adapter for both preview modes. Subscribes to the
 * builder form (unsaved values win) and converts everything into the exact
 * data shape the public weblink renders. Pure presentation: never saves,
 * never fetches, never mutates its inputs, never creates records.
 */
function useFullPreviewData(input: {
  quotation: Quotation;
  /** The version row currently being edited (never a different version). */
  savedVersion: QuotationVersion;
  control: Control<QuotationVersionInput>;
  settings?: CompanySettings | null | undefined;
  /** Uploaded flight-image URLs keyed by document id. */
  flightPreviewUrls: Record<string, string>;
  /** Already-loaded master lists (builder pickers); never refetched here. */
  masters?: PreviewMasterLists | null | undefined;
  /** Uploaded sightseeing-document image URLs keyed by document id. */
  sightseeingPreviewUrls?: Record<string, string> | null | undefined;
  /** Already-loaded team members for the destination-expert preview. */
  expertUsers?: ManagedUser[] | null | undefined;
}): PublicQuotation {
  const {
    quotation,
    savedVersion,
    control,
    settings,
    flightPreviewUrls,
    masters,
    sightseeingPreviewUrls,
    expertUsers,
  } = input;
  const live = useWatch({ control }) as unknown as QuotationVersionInput;
  const query = ((quotation as { query?: unknown }).query ?? {}) as Quotation['query'] & {
    itinerary?: Array<{
      country?: string | null;
      destination?: string | null;
      nights?: number | null;
    }> | null;
  };
  const presentations = usePreviewPresentations(
    live,
    masters,
    (quotation as { destinationSummary?: string | null }).destinationSummary ?? null,
    query?.itinerary ?? null,
  );
  return useMemo(() => {
    // React Hook Form updates nested field objects/arrays in place, so the
    // watched values can keep stable nested identities across keystrokes
    // while their content changes (e.g. typing in a sightseeing activity's
    // Custom Name mutates the same day/activity objects). Downstream memos
    // keyed on those nested identities (such as the itinerary normalizer)
    // would then never recompute and the preview would freeze on stale
    // content even though the form state itself is correct. Deep-cloning
    // here gives every nested structure a fresh identity per change, so both
    // preview modes stay synchronized on every keystroke — without touching
    // the authoritative form state, the iframe, scroll positions, or any API.
    let form: QuotationVersionInput;
    try {
      form = structuredClone(live) as QuotationVersionInput;
    } catch {
      // Form values are JSON-schema-shaped plain data (strings, numbers,
      // booleans, nulls, Dates, arrays, plain objects); if cloning ever
      // fails, fall back to the live object (previous behavior).
      form = live as QuotationVersionInput;
    }
    return buildFullPreviewData({
      quotation,
      savedVersion,
      form,
      settings,
      flightPreviewUrls,
      presentations,
      sightseeingPreviewUrls,
      expertUsers,
    });
  }, [quotation, savedVersion, live, settings, flightPreviewUrls, presentations, sightseeingPreviewUrls, expertUsers]);
}
/**
 * Persistent side-by-side live weblink preview for the Quotation Builder.
 * Renders the shared public presentation from live form state
 * (via `useFullPreviewData`) as an inline mobile phone panel that stays
 * mounted while the user switches tabs and edits:
 * deliberate programmatic scrolling is never performed here except
 * tab-driven navigation (see `activeSection`), so the reader's manual scroll
 * position survives typing (the phone frame itself persists and only its
 * inner content re-renders). Read-only: no saves, no finalizes, no published
 * records, no extra API calls.
 */
export function PinnedLiveQuotationPreview({
  quotation,
  savedVersion,
  settings,
  control,
  flightPreviewUrls,
  onClose,
  masters,
  sightseeingPreviewUrls,
  expertUsers,
  activeSection,
  activeItems,
}: {
  quotation: Quotation;
  savedVersion: QuotationVersion;
  settings?: CompanySettings | null;
  control: Control<QuotationVersionInput>;
  flightPreviewUrls: Record<string, string>;
  onClose: () => void;
  /** Already-loaded master lists (builder pickers); never refetched here. */
  masters?: PreviewMasterLists | null | undefined;
  /** Uploaded sightseeing-document image URLs keyed by document id. */
  sightseeingPreviewUrls?: Record<string, string> | null | undefined;
  /** Already-loaded team members for the destination-expert preview. */
  expertUsers?: ManagedUser[] | null | undefined;
  /**
   * Public section the phone navigates to whenever it changes (mapped from
   * the builder's active sub-tab); null leaves the scroll position alone.
   */
  activeSection?: string | null;
  /**
   * Item candidates within the section (`data-preview-item` values). The
   * phone navigates to the first match whenever the section/item combination
   * changes; unchanged targets never re-scroll, so typing cannot disturb the
   * reader's scroll position.
   */
  activeItems?: string[] | null;
}) {
  const data = useFullPreviewData({
    quotation,
    savedVersion,
    control,
    settings,
    flightPreviewUrls,
    masters,
    sightseeingPreviewUrls,
    expertUsers,
  });

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="flex max-h-[75vh] min-h-[50vh] flex-1 flex-col lg:max-h-none lg:min-h-0">
      <div className="flex items-center justify-between gap-3 border-b border-border bg-card px-4 py-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-slate-900">Live Weblink Preview</p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close live preview"
          className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
        >
          <X className="h-5 w-5" />
        </button>
      </div>
      <div className="flex min-h-0 flex-1 flex-col">
        <MobilePhonePreview
          data={data}
          activeSection={activeSection ?? null}
          activeItems={activeItems ?? null}
          frameTestId="pinned-preview-frame"
        />
      </div>
    </div>
  );
}
