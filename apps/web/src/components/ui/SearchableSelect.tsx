import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown, X } from 'lucide-react';

/**
 * A generic searchable select for a fixed list of string options.
 *
 * Built the same way as {@link SightseeingActivitySelect} and LeadSearchSelect:
 * a plain combobox input plus a listbox menu, no new dependency, so it
 * matches the rest of the UI. Typing filters the options; the full list is
 * shown when the field is focused without a query.
 *
 * The menu renders through a portal on `document.body` (the same mechanism as
 * InlineLeadField/UserActionMenu) with fixed positioning anchored to the
 * input. An inline absolute menu would be clipped by the `overflow-hidden`
 * form cards it lives in and would paint underneath following sections such
 * as the Create Lead/Cancel action panel.
 */

export interface SearchableSelectOption {
  value: string;
  label: string;
  /** Extra text used for search matching (e.g. an internal/private name). */
  searchText?: string | null;
}

interface SearchableSelectProps {
  ariaLabel: string;
  placeholder: string;
  options: SearchableSelectOption[];
  /** Currently selected option value, or '' when nothing is chosen. */
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  className?: string;
  /** Text shown when the query matches nothing. */
  emptyText?: string;
}

export function SearchableSelect({
  ariaLabel,
  placeholder,
  options,
  value,
  onChange,
  disabled = false,
  className = 'w-full rounded-lg border border-slate-300 bg-card py-2 pl-3 pr-8 text-sm',
  emptyText = 'No matching options',
}: SearchableSelectProps) {
  const listboxId = useId();
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const [menuPos, setMenuPos] = useState<{
    top: number;
    left: number;
    width: number;
    maxHeight: number;
  } | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLUListElement>(null);
  // The exact option the user last picked. Values are not unique (one city
  // name can exist in several states while storage stays a plain name), so
  // the display must remember the picked label instead of showing the first
  // value match — otherwise picking "Aurangabad (Maharashtra)" would render
  // as "Aurangabad (Bihar)".
  const [lastPicked, setLastPicked] = useState<SearchableSelectOption | null>(null);
  // Focus returns to the input after a pick so the keyboard stays put, but
  // that focus must not re-open the list the pick just closed.
  const justCommitted = useRef(false);

  const selected = useMemo(() => {
    if (!value) return null;
    if (
      lastPicked &&
      lastPicked.value === value &&
      options.some(
        (option) => option.value === lastPicked.value && option.label === lastPicked.label,
      )
    ) {
      return (
        options.find(
          (option) => option.value === lastPicked.value && option.label === lastPicked.label,
        ) ?? null
      );
    }
    return options.find((option) => option.value === value) ?? null;
  }, [options, value, lastPicked]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return options;
    return options.filter((option) =>
      [option.label, option.value, option.searchText]
        .filter(Boolean)
        .some((text) => String(text).toLowerCase().includes(needle)),
    );
  }, [options, query]);

  const close = () => {
    setOpen(false);
    setQuery('');
    setHighlight(0);
  };

  // A fresh set of matches invalidates whichever row was highlighted.
  useEffect(() => setHighlight(0), [query, options]);

  // Fixed portal position anchored to the input: same width, flips above the
  // input near the viewport bottom edge, and stays inside the viewport
  // horizontally. Mirrors the InlineLeadField portal positioning.
  const updateMenuPosition = useCallback(() => {
    const anchor = inputRef.current;
    if (!anchor) return;
    const rect = anchor.getBoundingClientRect();
    const menuWidth = Math.max(rect.width, 176);
    const estimatedHeight = Math.min(288, filtered.length * 36 + 8);
    const measuredHeight = menuRef.current?.offsetHeight;
    const needed = measuredHeight && measuredHeight > 0 ? measuredHeight : estimatedHeight;
    const viewportPadding = 8;
    const spaceBelow = window.innerHeight - rect.bottom - viewportPadding;
    const spaceAbove = rect.top - viewportPadding;
    const shouldFlip = spaceBelow < needed && spaceAbove > spaceBelow;
    let top: number;
    let maxHeight: number;
    if (shouldFlip) {
      maxHeight = Math.min(288, spaceAbove - 4);
      const height = Math.min(needed, maxHeight);
      top = rect.top - height - 4;
    } else {
      maxHeight = Math.min(288, spaceBelow - 4);
      top = rect.bottom + 4;
    }
    let left = rect.left;
    if (left + menuWidth > window.innerWidth - viewportPadding) {
      left = window.innerWidth - menuWidth - viewportPadding;
    }
    if (left < viewportPadding) left = viewportPadding;
    setMenuPos({ top, left, width: menuWidth, maxHeight: Math.max(120, maxHeight) });
  }, [filtered.length]);

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
      // The portal menu lives outside the root container, so both must be
      // checked before dismissing. Deliberately no blur handler: a blur onto
      // a portaled option would unmount the menu before its click lands.
      if (rootRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      close();
    };
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, [open]);

  const commit = (option: SearchableSelectOption) => {
    setQuery('');
    setOpen(false);
    setHighlight(0);
    setLastPicked(option);
    if (option.value !== value) onChange(option.value);
    justCommitted.current = true;
    inputRef.current?.focus();
    justCommitted.current = false;
  };

  const clear = () => {
    close();
    if (value) onChange('');
    inputRef.current?.focus();
  };

  // While the user is typing show the query; otherwise show the selection.
  const display = query || (selected?.label ?? '');

  return (
    <div ref={rootRef} className="relative">
      <div className="relative">
        <input
          ref={inputRef}
          role="combobox"
          aria-label={ariaLabel}
          aria-expanded={open}
          aria-controls={listboxId}
          aria-autocomplete="list"
          {...(open && filtered[highlight]
            ? { 'aria-activedescendant': `${listboxId}-${highlight}` }
            : {})}
          disabled={disabled}
          placeholder={placeholder}
          value={display}
          onFocus={() => {
            if (!justCommitted.current) setOpen(true);
          }}
          onMouseDown={() => setOpen((isOpen) => !isOpen)}
          onChange={(event) => {
            setQuery(event.target.value);
            setOpen(true);
          }}
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown') {
              event.preventDefault();
              if (!open) setOpen(true);
              else if (filtered.length) setHighlight((row) => (row + 1) % filtered.length);
            } else if (event.key === 'ArrowUp') {
              event.preventDefault();
              if (filtered.length)
                setHighlight((row) => (row - 1 + filtered.length) % filtered.length);
            } else if (event.key === 'Enter') {
              event.preventDefault();
              const option = filtered[highlight];
              if (open && option) commit(option);
            } else if (event.key === 'Escape') {
              close();
              inputRef.current?.blur();
            }
          }}
          className={className}
        />
        <ChevronDown
          aria-hidden="true"
          className="pointer-events-none absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
        />
        {value && !disabled && (
          <button
            type="button"
            aria-label={`Clear ${ariaLabel}`}
            onClick={(event) => {
              event.stopPropagation();
              clear();
            }}
            className="absolute right-7 top-1/2 -translate-y-1/2 rounded p-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
      {open &&
        !disabled &&
        createPortal(
          <ul
            ref={menuRef}
            id={listboxId}
            role="listbox"
            // Deliberately distinct from the input's label: sharing it would give
            // the field two elements with the same accessible name.
            aria-label={`${ariaLabel} search results`}
            style={
              menuPos
                ? {
                    position: 'fixed',
                    top: menuPos.top,
                    left: menuPos.left,
                    width: menuPos.width,
                    maxHeight: menuPos.maxHeight,
                  }
                : { position: 'fixed', visibility: 'hidden' as const }
            }
            className="z-[80] overflow-auto rounded-lg border border-slate-200 bg-white py-1 shadow-lg"
          >
            {filtered.length === 0 && (
              <li aria-hidden="true" className="px-3 py-2 text-sm text-slate-400">
                {query.trim() ? `No matches for "${query.trim()}"` : emptyText}
              </li>
            )}
            {filtered.map((option, index) => (
              // Key includes the label: distinct options may share a value
              // (e.g. one city name in two states) while values stay plain
              // city names for storage compatibility.
              <li key={`${option.value}__${option.label}`} role="none">
                <button
                  type="button"
                  role="option"
                  id={`${listboxId}-${index}`}
                  aria-selected={option.value === value}
                  onMouseEnter={() => setHighlight(index)}
                  onClick={() => commit(option)}
                  className={`flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm ${
                    highlight === index ? 'bg-slate-100' : ''
                  }`}
                >
                  <span className="min-w-0 truncate">{option.label}</span>
                  {option.value === value && option.label === selected?.label && (
                    <Check className="h-4 w-4 shrink-0 text-emerald-600" />
                  )}
                </button>
              </li>
            ))}
          </ul>,
          document.body,
        )}
    </div>
  );
}
