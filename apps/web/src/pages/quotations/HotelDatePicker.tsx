import { useEffect, useId, useRef, useState } from 'react';
import { Calendar as CalendarIcon, ChevronLeft, ChevronRight, X } from 'lucide-react';
import { cn } from '@/utils/cn';

/**
 * UTC calendar-day utilities. All arithmetic uses UTC calendar components
 * (never fixed millisecond offsets) so month/year boundaries and timezones
 * cannot produce off-by-one-day errors.
 */

const DAY_MS = 86_400_000;

/** Strict YYYY-MM-DD → UTC-midnight Date; accepts Date pass-through. */
export function parseISODateString(value: string | Date | null | undefined): Date | null {
  if (value == null) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  const raw = String(value).trim();
  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  // Guard against overflow (e.g. 2026-02-30 normalizes into March).
  if (
    date.getUTCFullYear() !== Number(match[1]) ||
    date.getUTCMonth() !== Number(match[2]) - 1 ||
    date.getUTCDate() !== Number(match[3])
  ) {
    return null;
  }
  return date;
}

/** UTC-midnight Date → YYYY-MM-DD. */
export function toISODateString(date: Date): string {
  const yyyy = date.getUTCFullYear();
  const mm = String(date.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(date.getUTCDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

/** UTC-midnight Date → DD-MM-YYYY for display (matches the Check-In field). */
export function toDisplayDateString(date: Date): string {
  const yyyy = date.getUTCFullYear();
  const mm = String(date.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(date.getUTCDate()).padStart(2, '0');
  return `${dd}-${mm}-${yyyy}`;
}

function fromUTCParts(yyyy: number, mm: number, dd: number): Date | null {
  const date = new Date(Date.UTC(yyyy, mm - 1, dd));
  // Guard against overflow (e.g. 30-02-2026 normalizes into March).
  if (
    date.getUTCFullYear() !== yyyy ||
    date.getUTCMonth() !== mm - 1 ||
    date.getUTCDate() !== dd
  ) {
    return null;
  }
  return date;
}

/**
 * Manual-entry parser: accepts DD-MM-YYYY (displayed format) and YYYY-MM-DD
 * (ISO, kept for compatibility), with `-` or `/` separators. Strict and
 * overflow-checked; returns null for anything else.
 */
export function parseDateInputString(value: string | null | undefined): Date | null {
  if (value == null) return null;
  const raw = String(value).trim();
  if (!raw) return null;
  let match = raw.match(/^(\d{2})[-/](\d{2})[-/](\d{4})$/);
  if (match) return fromUTCParts(Number(match[3]), Number(match[2]), Number(match[1]));
  match = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (match) return fromUTCParts(Number(match[1]), Number(match[2]), Number(match[3]));
  return null;
}

/** Add calendar days via UTC components (month/year rollover handled). */
export function addCalendarDays(date: Date, days: number): Date {
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + days),
  );
}

/** UTC day-number for constraint comparisons. */
export function utcDayNumber(date: Date): number {
  return Math.round(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()) / DAY_MS,
  );
}

const sameUTCDate = (a: Date | null, b: Date | null): boolean =>
  a !== null && b !== null && utcDayNumber(a) === utcDayNumber(b);

const monthLabel = (year: number, month: number): string =>
  new Intl.DateTimeFormat('en-GB', { month: 'long', year: 'numeric' }).format(
    new Date(Date.UTC(year, month, 1)),
  );

const dayAriaLabel = (date: Date): string =>
  new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }).format(
    date,
  );

const WEEKDAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

export interface HotelDatePickerLabels {
  /** Accessible name of the text input (e.g. `Hotel check-in`). */
  input: string;
  /** Accessible name + tooltip of the calendar toggle button. */
  toggle: string;
  /** Accessible name of the calendar popup. */
  dialog: string;
  /** Accessible name of the clear button. */
  clear: string;
  /** Optional prefix rendered before the minimum date (e.g. `Earliest checkout`). */
  minHint?: string;
}

export interface HotelDatePickerProps {
  /** Committed value (string/Date). Displayed as DD-MM-YYYY. */
  value: string | Date | null | undefined;
  /** Commits a newly selected (or cleared) date. Never called on open. */
  onSelect: (date: Date | null) => void;
  /** Inclusive minimum selectable date; dates before it are disabled. */
  minDate?: string | Date | null | undefined;
  /** Day to focus when no valid selection exists (falls back to minDate). */
  initialFocusDate?: string | Date | null | undefined;
  labels: HotelDatePickerLabels;
  /** Class for the text input (e.g. the form `field` style). */
  inputClassName?: string | undefined;
}

/**
 * Reusable accessible hotel date picker (used identically for Check-in and
 * Check-out — only the date-selection rules passed in differ).
 *
 * Native `<input type="date">` popups expose no cross-browser API for focusing
 * a specific day, so the calendar here is a custom popup. Opening it never
 * commits a value; an existing valid selection keeps its month and highlight.
 */
export function HotelDatePicker({
  value,
  onSelect,
  minDate: minDateProp,
  initialFocusDate: initialFocusDateProp,
  labels,
  inputClassName,
}: HotelDatePickerProps) {
  const selected = parseISODateString(value);
  const minDate = parseISODateString(minDateProp ?? null);
  const initialFocusDate = parseISODateString(initialFocusDateProp ?? null);
  const isValidSelection =
    selected !== null && (minDate === null || utcDayNumber(selected) >= utcDayNumber(minDate));

  const [open, setOpen] = useState(false);
  const [viewYear, setViewYear] = useState(0);
  const [viewMonth, setViewMonth] = useState(0);
  // Manual-entry draft. Null means "follow the committed value".
  const [draft, setDraft] = useState<string | null>(null);
  const dialogId = useId();
  const toggleRef = useRef<HTMLButtonElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const committedText = selected ? toDisplayDateString(selected) : '';
  const shownText = draft ?? committedText;

  // External value changes (e.g. another control edited the date) resync the
  // draft, unless the user is actively typing in this input.
  useEffect(() => {
    if (document.activeElement !== inputRef.current) setDraft(null);
  }, [committedText]);

  // The focus target when the calendar opens: the valid selection when one
  // is kept, otherwise the explicit initial date, otherwise the minimum.
  // Null when none exists.
  const focusTarget =
    isValidSelection && selected
      ? selected
      : (initialFocusDate ?? minDate);
  const focusTargetKey = focusTarget ? toISODateString(focusTarget) : null;

  const openCalendar = () => {
    const anchor =
      isValidSelection && selected
        ? selected
        : (initialFocusDate ?? minDate ?? selected ?? new Date());
    // Anchor month uses UTC components so the viewed month never shifts by timezone.
    const base = new Date(
      Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth(), anchor.getUTCDate()),
    );
    setViewYear(base.getUTCFullYear());
    setViewMonth(base.getUTCMonth());
    setOpen(true);
  };

  // Close on outside pointer press; Escape is handled on the dialog.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open ]);

  const moveMonth = (delta: number) => {
    const next = new Date(Date.UTC(viewYear, viewMonth + delta, 1));
    setViewYear(next.getUTCFullYear());
    setViewMonth(next.getUTCMonth());
  };

  const commitDraft = (raw: string) => {
    const trimmed = raw.trim();
    if (trimmed === '') {
      onSelect(null);
      return;
    }
    const parsed = parseDateInputString(trimmed);
    // Ignore unparseable keystrokes; keep the draft visible for correction.
    if (parsed) onSelect(parsed);
  };

  // Month grid cells: leading blanks + every day of the viewed month.
  const firstWeekday = new Date(Date.UTC(viewYear, viewMonth, 1)).getUTCDay();
  const daysInMonth = new Date(Date.UTC(viewYear, viewMonth + 1, 0)).getUTCDate();
  const cells: Array<{ date: Date } | null> = [];
  for (let i = 0; i < firstWeekday; i += 1) cells.push(null);
  for (let day = 1; day <= daysInMonth; day += 1) {
    cells.push({ date: new Date(Date.UTC(viewYear, viewMonth, day)) });
  }

  const dayRefs = useRef(new Map<string, HTMLButtonElement>());

  // Focus the target day when the calendar opens (valid selection first,
  // otherwise the initial date, otherwise the minimum). Runs once per open;
  // month navigation never steals focus.
  const openedRef = useRef(false);
  useEffect(() => {
    if (!open || openedRef.current) return;
    openedRef.current = true;
    if (focusTargetKey) dayRefs.current.get(focusTargetKey)?.focus();
  }, [open, focusTargetKey]);
  useEffect(() => {
    if (!open) openedRef.current = false;
  }, [open]);
  const focusDay = (key: string) => dayRefs.current.get(key)?.focus();

  const onDayKeyDown = (event: React.KeyboardEvent, key: string) => {
    const ordered = cells
      .map((cell, i) => (cell ? { key: toISODateString(cell.date), i } : null))
      .filter((entry): entry is { key: string; i: number } => entry !== null);
    const position = ordered.findIndex((entry) => entry.key === key);
    const move = (delta: number) => {
      const next = ordered[position + delta];
      if (next) {
        event.preventDefault();
        focusDay(next.key);
      }
    };
    if (event.key === 'ArrowLeft') move(-1);
    else if (event.key === 'ArrowRight') move(1);
    else if (event.key === 'ArrowUp') move(-7);
    else if (event.key === 'ArrowDown') move(7);
    else if (event.key === 'Home') {
      event.preventDefault();
      const first = ordered[0];
      if (first) focusDay(first.key);
    } else if (event.key === 'End') {
      event.preventDefault();
      const last = ordered[ordered.length - 1];
      if (last) focusDay(last.key);
    }
  };

  return (
    <div ref={rootRef} className="mt-1">
      <div className="flex items-center gap-1.5">
        <input
          ref={inputRef}
          aria-label={labels.input}
          inputMode="numeric"
          placeholder="DD-MM-YYYY"
          autoComplete="off"
          value={shownText}
          onChange={(event) => {
            const raw = event.target.value;
            setDraft(raw);
            commitDraft(raw);
          }}
          onBlur={() => {
            // On blur, drop an unparseable draft so the committed value shows.
            if (draft !== null && draft.trim() !== '' && !parseDateInputString(draft.trim())) {
              setDraft(null);
            }
          }}
          className={cn('min-w-0 flex-1', inputClassName)}
        />
        <button
          ref={toggleRef}
          type="button"
          aria-label={labels.toggle}
          title={labels.toggle}
          aria-expanded={open}
          aria-controls={dialogId}
          onClick={() => {
            if (open) {
              setOpen(false);
            } else {
              openCalendar();
            }
          }}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-slate-300 bg-white text-slate-600 transition hover:border-brand-300 hover:bg-brand-50 hover:text-brand-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/60"
        >
          <CalendarIcon className="h-4 w-4" aria-hidden="true" />
        </button>
        {selected !== null && (
          <button
            type="button"
            aria-label={labels.clear}
            title={labels.clear}
            onClick={() => {
              setDraft(null);
              onSelect(null);
            }}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-slate-300 bg-white text-slate-500 transition hover:border-slate-400 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/60"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        )}
      </div>

      {open && (
        <div
          id={dialogId}
          role="dialog"
          aria-label={labels.dialog}
          aria-modal="false"
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.stopPropagation();
              setOpen(false);
              toggleRef.current?.focus();
            }
          }}
          className="mt-2 rounded-xl border border-slate-200 bg-white p-3 shadow-lg"
        >
          <div className="mb-2 flex items-center justify-between gap-2">
            <button
              type="button"
              aria-label="Previous month"
              onClick={() => moveMonth(-1)}
              className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 text-slate-600 transition hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/60"
            >
              <ChevronLeft className="h-4 w-4" aria-hidden="true" />
            </button>
            <p aria-live="polite" className="text-sm font-semibold text-slate-800">
              {monthLabel(viewYear, viewMonth)}
            </p>
            <button
              type="button"
              aria-label="Next month"
              onClick={() => moveMonth(1)}
              className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 text-slate-600 transition hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/60"
            >
              <ChevronRight className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
          {labels.minHint && minDate && (
            <p className="mb-2 text-xs text-slate-500">
              {labels.minHint}: {dayAriaLabel(minDate)}
            </p>
          )}
          <div aria-hidden="true" className="grid grid-cols-7 gap-1">
            {WEEKDAYS.map((day) => (
              <span key={day} className="py-1 text-center text-xs font-semibold text-slate-400">
                {day}
              </span>
            ))}
          </div>
          <div aria-label={`${labels.dialog} calendar`} role="group" className="grid grid-cols-7 gap-1">
            {cells.map((cell, index) => {
              if (!cell) return <span key={`blank-${index}`} />;
              const key = toISODateString(cell.date);
              const disabled = minDate !== null && utcDayNumber(cell.date) < utcDayNumber(minDate);
              const isSelected = sameUTCDate(cell.date, selected);
              const isTarget = focusTargetKey !== null && key === focusTargetKey && !isSelected;
              return (
                <button
                  ref={(el) => {
                    if (el) dayRefs.current.set(key, el);
                    else dayRefs.current.delete(key);
                  }}
                  key={key}
                  type="button"
                  aria-label={dayAriaLabel(cell.date)}
                  aria-disabled={disabled}
                  disabled={disabled}
                  onClick={() => {
                    setDraft(null);
                    onSelect(cell.date);
                    setOpen(false);
                    toggleRef.current?.focus();
                  }}
                  onKeyDown={(event) => onDayKeyDown(event, key)}
                  className={cn(
                    'flex h-9 items-center justify-center rounded-lg text-sm tabular-nums transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/60',
                    isSelected
                      ? 'bg-brand-600 font-semibold text-white hover:bg-brand-700'
                      : isTarget
                        ? 'border-2 border-brand-600 font-semibold text-brand-700 hover:bg-brand-50'
                        : 'text-slate-700 hover:bg-slate-100',
                    disabled && 'cursor-not-allowed opacity-40 hover:bg-transparent',
                  )}
                >
                  {cell.date.getUTCDate()}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

export interface HotelCheckoutDatePickerProps {
  /** Current check-in (string/Date) — drives min date + initial focus. */
  checkInDate: string | Date | null | undefined;
  /** Current checkout (string/Date). */
  checkOutDate: string | Date | null | undefined;
  /** Commits a newly selected (or cleared) checkout date. Never called on open. */
  onSelect: (date: Date | null) => void;
  /** Class for the text input (e.g. the form `field` style). */
  inputClassName?: string;
}

/**
 * Hotel checkout field: the shared date picker wired with the checkout
 * rules — the minimum is the day after check-in, so an empty checkout opens
 * focused on check-in + 1 and earlier dates stay disabled. Checkout must be
 * strictly later than check-in.
 */
export function HotelCheckoutDatePicker({
  checkInDate,
  checkOutDate,
  onSelect,
  inputClassName,
}: HotelCheckoutDatePickerProps) {
  const checkIn = parseISODateString(checkInDate);
  const minDate = checkIn ? addCalendarDays(checkIn, 1) : null;
  return (
    <HotelDatePicker
      value={checkOutDate}
      onSelect={onSelect}
      minDate={minDate}
      labels={{
        input: 'Hotel check-out',
        toggle: 'Open checkout calendar',
        dialog: 'Choose checkout date',
        clear: 'Clear checkout date',
        minHint: 'Earliest checkout',
      }}
      inputClassName={inputClassName}
    />
  );
}
