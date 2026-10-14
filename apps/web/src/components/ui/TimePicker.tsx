import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Clock } from 'lucide-react';

/**
 * A custom 12-hour time picker with three aligned columns (Hour | Minute |
 * AM/PM), replacing the browser-native time popup whose hour/minute/AM-PM
 * columns render with awkward gaps and inconsistent alignment.
 *
 * Stored value stays a 24-hour `"HH:MM"` string (or null when empty) so API
 * payloads, duration maths and validation are untouched; only the popup UI
 * is custom. Every column uses identical row geometry, so highlighting can
 * never shift rows.
 */

export interface ParsedTime {
  hour24: number;
  minute: number;
}

const pad2 = (value: number) => String(value).padStart(2, '0');

/** Parse a stored `"HH:MM"` (24h) value; null when empty or unparseable. */
export function parseTime24(value: string | null | undefined): ParsedTime | null {
  if (value == null) return null;
  const match = String(value)
    .trim()
    .match(/^(\d{1,2}):(\d{1,2})/);
  if (!match) return null;
  const hour24 = Number(match[1]);
  const minute = Number(match[2]);
  if (!Number.isInteger(hour24) || !Number.isInteger(minute)) return null;
  if (hour24 < 0 || hour24 > 23 || minute < 0 || minute > 59) return null;
  return { hour24, minute };
}

/** Display a 24-hour time the way the form always showed it (e.g. `01:00 PM`). */
export function formatTime12(hour24: number, minute: number): string {
  const period = hour24 < 12 ? 'AM' : 'PM';
  const hour12 = hour24 % 12 === 0 ? 12 : hour24 % 12;
  return `${pad2(hour12)}:${pad2(minute)} ${period}`;
}

/** Display a stored value, or '' when empty so the placeholder shows. */
export function formatStoredTime(value: string | null | undefined): string {
  const parsed = parseTime24(value);
  return parsed ? formatTime12(parsed.hour24, parsed.minute) : '';
}

/** Compose a stored `"HH:MM"` value from 12-hour parts (12 AM → 00, 12 PM → 12). */
export function toTime24(hour12: number, minute: number, period: 'AM' | 'PM'): string {
  const normalizedHour = hour12 % 12;
  const hour24 = period === 'AM' ? normalizedHour : normalizedHour + 12;
  return `${pad2(hour24)}:${pad2(minute)}`;
}

const HOURS = Array.from({ length: 12 }, (_, index) => index + 1);
const MINUTES = Array.from({ length: 60 }, (_, index) => index);
const PERIODS = ['AM', 'PM'] as const;

export interface TimePickerProps {
  /** Stored 24-hour `"HH:MM"` value, or null/'' when empty. */
  value: string | null;
  onChange: (value: string | null) => void;
  ariaLabel: string;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
}

export function TimePicker({
  value,
  onChange,
  ariaLabel,
  placeholder = '--:--',
  disabled = false,
  className = 'w-full rounded-lg border border-border bg-card px-3 py-2 text-sm h-[38px] shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/20 focus-visible:border-ring transition-colors',
}: TimePickerProps) {
  const listboxBaseId = useId();
  const [open, setOpen] = useState(false);
  const [menuPos, setMenuPos] = useState<{ top: number; left: number } | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  // Which column keyboard arrows currently drive (hours/minutes/period).
  const [activeColumn, setActiveColumn] = useState(0);
  const optionRefs = useRef<Array<Array<HTMLButtonElement | null>>>([[], [], []]);
  // Focus returns to the input after a pick so the keyboard stays put, but
  // that focus must not re-open the list the pick just closed.
  const justCommitted = useRef(false);

  const parsed = parseTime24(value);
  const selectedHour12 = parsed ? (parsed.hour24 % 12 === 0 ? 12 : parsed.hour24 % 12) : null;
  const selectedMinute = parsed ? parsed.minute : null;
  const selectedPeriod = parsed ? (parsed.hour24 < 12 ? 'AM' : 'PM') : null;

  const close = useCallback(
    (refocusInput = false) => {
      setOpen(false);
      if (refocusInput) {
        justCommitted.current = true;
        inputRef.current?.focus();
        justCommitted.current = false;
      }
    },
    [],
  );

  const openMenu = useCallback(
    (moveFocus: boolean) => {
      if (disabled) return;
      setOpen(true);
      setActiveColumn(0);
      if (moveFocus) {
        // Focus lands on the selected hour (or the first) once mounted.
        window.setTimeout(() => {
          const buttons = optionRefs.current[0] ?? [];
          const target =
            buttons.find((button) => button?.getAttribute('aria-selected') === 'true') ??
            buttons[0];
          target?.focus();
        }, 0);
      }
    },
    [disabled],
  );

  // Fixed portal position anchored to the input: below it when space allows,
  // otherwise above; always clamped into the viewport. Content never changes
  // size (12/60/2 static rows), so nothing repositions it mid-interaction.
  const updateMenuPosition = useCallback(() => {
    const anchor = inputRef.current;
    if (!anchor) return;
    const rect = anchor.getBoundingClientRect();
    const menuWidth = 264;
    const menuHeight = 300;
    const viewportPadding = 8;
    const spaceBelow = window.innerHeight - rect.bottom - viewportPadding;
    const top =
      spaceBelow >= menuHeight || rect.top - menuHeight - 4 < viewportPadding
        ? rect.bottom + 4
        : rect.top - menuHeight - 4;
    let left = rect.left;
    const maxLeft = window.innerWidth - menuWidth - viewportPadding;
    if (left > maxLeft) left = Math.max(viewportPadding, maxLeft);
    if (left < viewportPadding) left = viewportPadding;
    setMenuPos({ top, left });
  }, []);

  useLayoutEffect(() => {
    if (open) updateMenuPosition();
  }, [open, updateMenuPosition]);

  useEffect(() => {
    if (!open) return undefined;
    const handleReposition = () => updateMenuPosition();
    window.addEventListener('scroll', handleReposition, true);
    window.addEventListener('resize', handleReposition);
    return () => {
      window.removeEventListener('scroll', handleReposition, true);
      window.removeEventListener('resize', handleReposition);
    };
  }, [open, updateMenuPosition]);

  useEffect(() => {
    if (!open) return undefined;
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (rootRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      close();
    };
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, [open, close]);

  // Scroll the selected option of every column into view on open. Guarded:
  // jsdom has no scrollIntoView implementation.
  useEffect(() => {
    if (!open) return;
    for (const buttons of optionRefs.current) {
      const selected = buttons.find((button) => button?.getAttribute('aria-selected') === 'true');
      try {
        selected?.scrollIntoView?.({ block: 'center' });
      } catch {
        // Scrolling is best-effort; selection state is the source of truth.
      }
    }
  }, [open]);

  const pickHour = (hour12: number) => {
    onChange(toTime24(hour12, selectedMinute ?? 0, selectedPeriod ?? 'AM'));
  };
  const pickMinute = (minute: number) => {
    onChange(toTime24(selectedHour12 ?? 12, minute, selectedPeriod ?? 'AM'));
  };
  const pickPeriod = (period: 'AM' | 'PM') => {
    onChange(toTime24(selectedHour12 ?? 12, selectedMinute ?? 0, period));
    close(true);
  };

  const focusOption = (column: number, index: number) => {
    const buttons = optionRefs.current[column] ?? [];
    const clamped = Math.max(0, Math.min(buttons.length - 1, index));
    setActiveColumn(column);
    buttons[clamped]?.focus();
  };

  const stepIndex = (column: number, direction: 1 | -1): number => {
    const buttons = optionRefs.current[column] ?? [];
    if (!buttons.length) return 0;
    const active = document.activeElement as HTMLElement | null;
    const at = buttons.indexOf(active as HTMLButtonElement);
    if (at >= 0) return (at + direction + buttons.length) % buttons.length;
    // Focus is outside the panel (e.g. the input): step from the selection,
    // or from the edge when nothing is selected yet.
    const selectedAt = buttons.findIndex(
      (button) => button?.getAttribute('aria-selected') === 'true',
    );
    if (selectedAt >= 0) return (selectedAt + direction + buttons.length) % buttons.length;
    return direction === 1 ? 0 : buttons.length - 1;
  };

  const onPanelKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'ArrowRight') {
      event.preventDefault();
      focusOption(Math.min(2, activeColumn + 1), 0);
    } else if (event.key === 'ArrowLeft') {
      event.preventDefault();
      focusOption(Math.max(0, activeColumn - 1), 0);
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const direction = event.key === 'ArrowDown' ? 1 : -1;
      const next = stepIndex(activeColumn, direction as 1 | -1);
      const target = (optionRefs.current[activeColumn] ?? [])[next];
      target?.focus();
      // Committing on arrow mirrors the native time-stepper behaviour.
      target?.click();
    } else if (event.key === 'Home') {
      event.preventDefault();
      const target = (optionRefs.current[activeColumn] ?? [])[0];
      target?.focus();
      target?.click();
    } else if (event.key === 'End') {
      event.preventDefault();
      const buttons = optionRefs.current[activeColumn] ?? [];
      const target = buttons[buttons.length - 1];
      target?.focus();
      target?.click();
    } else if (event.key === 'Enter') {
      // Never submit the surrounding form. When focus sits on an option,
      // commit it explicitly (preventDefault above would otherwise cancel the
      // button's own keyboard activation while the menu unmounts).
      event.preventDefault();
      const active = document.activeElement as HTMLElement | null;
      if (active?.getAttribute?.('role') === 'option') active.click();
      close(true);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      close(true);
    } else if (event.key === 'Tab') {
      close();
    }
  };

  const columns: Array<{ key: string; title: string; aria: string; options: Array<string>; scroll: boolean }> = [
    {
      key: 'hour',
      title: 'Hour',
      aria: `${ariaLabel} hour`,
      options: HOURS.map((hour) => pad2(hour)),
      scroll: true,
    },
    {
      key: 'minute',
      title: 'Minute',
      aria: `${ariaLabel} minute`,
      options: MINUTES.map((minute) => pad2(minute)),
      scroll: true,
    },
    { key: 'period', title: 'AM/PM', aria: `${ariaLabel} AM or PM`, options: [...PERIODS], scroll: false },
  ];

  const isSelected = (column: number, option: string): boolean => {
    if (column === 0) return selectedHour12 != null && pad2(selectedHour12) === option;
    if (column === 1) return selectedMinute != null && pad2(selectedMinute) === option;
    return selectedPeriod != null && selectedPeriod === option;
  };

  const pick = (column: number, option: string) => {
    if (column === 0) pickHour(Number(option));
    else if (column === 1) pickMinute(Number(option));
    else pickPeriod(option as 'AM' | 'PM');
  };

  return (
    <div ref={rootRef} className="relative">
      <div className="relative">
        <input
          ref={inputRef}
          readOnly
          role="combobox"
          aria-label={ariaLabel}
          aria-expanded={open}
          aria-controls={`${listboxBaseId}-panel`}
          aria-autocomplete="none"
          disabled={disabled}
          placeholder={placeholder}
          value={formatStoredTime(value)}
          onFocus={() => {
            if (justCommitted.current || open) return;
            openMenu(false);
          }}
          onMouseDown={(event) => {
            if (disabled) return;
            if (open) {
              event.preventDefault();
              close();
            } else if (document.activeElement === inputRef.current) {
              // Already focused: no focus event will follow to open it.
              openMenu(false);
            }
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ' || event.key === 'ArrowDown') {
              // Never submit the surrounding form from the time field.
              event.preventDefault();
              if (!open) openMenu(true);
            } else if (event.key === 'Escape' && open) {
              event.preventDefault();
              close();
            } else if (event.key === 'Tab' && open) {
              close();
            }
          }}
          className={`${className} pr-9`}
        />
        <Clock
          aria-hidden="true"
          className="pointer-events-none absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
        />
      </div>
      {open &&
        !disabled &&
        createPortal(
          <div
            ref={menuRef}
            role="dialog"
            id={`${listboxBaseId}-panel`}
            aria-label={`${ariaLabel} picker`}
            onKeyDown={onPanelKeyDown}
            style={
              menuPos
                ? {
                    position: 'fixed',
                    top: menuPos.top,
                    left: menuPos.left,
                    width: 264,
                  }
                : { position: 'fixed', visibility: 'hidden' as const }
            }
            className="z-[80] rounded-lg border border-slate-200 bg-white p-2 shadow-lg"
          >
            <div className="grid grid-cols-3 divide-x divide-slate-100">
              {columns.map((column, columnIndex) => (
                <div key={column.key} className="min-w-0 px-1">
                  <div
                    aria-hidden="true"
                    className="select-none px-2 pb-1 pt-1 text-center text-[11px] font-semibold uppercase tracking-wider text-slate-400"
                  >
                    {column.title}
                  </div>
                  <div
                    role="listbox"
                    aria-label={column.aria}
                    className={`max-h-56 overflow-y-auto py-1 ${column.scroll ? 'time-picker-scroll' : ''}`}
                  >
                    {column.options.map((option, optionIndex) => {
                      const selected = isSelected(columnIndex, option);
                      return (
                        <button
                          key={option}
                          ref={(element) => {
                            optionRefs.current[columnIndex]![optionIndex] = element;
                          }}
                          type="button"
                          role="option"
                          aria-selected={selected}
                          aria-label={`${column.title} ${option}`}
                          onClick={() => pick(columnIndex, option)}
                          onFocus={() => setActiveColumn(columnIndex)}
                          className={`flex h-8 w-full items-center justify-center rounded-md px-2 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50 ${
                            selected
                              ? 'bg-brand-50 font-semibold text-brand-700'
                              : 'font-normal text-slate-700 hover:bg-slate-100'
                          }`}
                        >
                          {option}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}
