import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown, ChevronRight, X } from 'lucide-react';

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
  /**
   * Text shown in the closed input after selection. Defaults to `label`.
   * Lets the menu show a long combined label while the committed field shows
   * a short public name.
   */
  selectedLabel?: string | null;
  /**
   * Optional group heading this option belongs to (e.g. a country). Grouped
   * rendering activates when at least one option carries a group; options
   * without one fall into an `Other` group pinned last.
   */
  group?: string | null;
}

/** Fallback group for options without a country/group value. */
export const SEARCHABLE_SELECT_OTHER_GROUP = 'Other';

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
  /**
   * Render groups as collapsible country rows (accordion: expanding one
   * collapses the previous). Groups start collapsed; typing a query
   * auto-expands every group with matches, and clearing restores the
   * collapsed list. Off by default — other dropdowns keep flat rendering.
   */
  expandableGroups?: boolean;
  /**
   * Always open the menu above the input (never below), with its bottom edge
   * a small gap above the input's top edge. When space above is limited the
   * menu shrinks to fit and scrolls internally instead of flipping below.
   * Off by default — other dropdowns keep the automatic flip behavior.
   */
  openUpward?: boolean;
}

/** One visible menu row: a group header or a selectable option. */
type SelectMenuRow =
  | { kind: 'header'; key: string; id: string; heading: string; expanded: boolean }
  | {
      kind: 'option';
      key: string;
      id: string;
      option: SearchableSelectOption;
      /** Position in the flat filtered list (stable option identity). */
      flatIndex: number;
    };

/** One selectable menu row. The label always renders in full and wraps onto
 * multiple lines (never truncated) so long names stay visible; the row grows
 * with its content. `rowIndex` is the row's position among the currently
 * visible rows (headers included) for keyboard highlight; `optionId` is the
 * stable dom id derived from the flat filtered position.
 *
 * Geometry is fully static: padding is spelled out explicitly (indented rows
 * use `pl-9 pr-3`, never `px-3` plus an overriding `pl-9` that would depend
 * on stylesheet ordering), and the hover/keyboard highlight toggles ONLY the
 * background class — never padding, margin, border, transform or alignment —
 * so hovering can never move the row by even one pixel. */
function OptionRow({
  option,
  rowIndex,
  optionId,
  highlight,
  selected,
  value,
  indent,
  onHighlight,
  onCommit,
}: {
  option: SearchableSelectOption;
  rowIndex: number;
  optionId: string;
  highlight: number;
  selected: SearchableSelectOption | null;
  value: string;
  indent?: boolean;
  onHighlight: (index: number) => void;
  onCommit: (option: SearchableSelectOption) => void;
}) {
  return (
    // Key includes the label: distinct options may share a value
    // (e.g. one city name in two states) while values stay plain
    // city names for storage compatibility.
    <li key={`${option.value}__${option.label}`} role="none">
      <button
        type="button"
        role="option"
        id={optionId}
        aria-selected={option.value === value}
        onMouseEnter={() => onHighlight(rowIndex)}
        onClick={() => onCommit(option)}
        className={`flex w-full items-start justify-between gap-2 py-2 text-left text-sm ${
          indent ? 'pl-9 pr-3' : 'px-3'
        } ${highlight === rowIndex ? 'bg-slate-100' : ''}`}
      >
        <span className="min-w-0 flex-1 whitespace-normal break-words">{option.label}</span>
        {option.value === value && option.label === selected?.label && (
          <Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
        )}
      </button>
    </li>
  );
}

/** One collapsible country header row. Toggling never selects a destination. */
function CountryRow({
  heading,
  expanded,
  rowIndex,
  headerId,
  highlight,
  onHighlight,
  onToggle,
}: {
  heading: string;
  expanded: boolean;
  rowIndex: number;
  headerId: string;
  highlight: number;
  onHighlight: (index: number) => void;
  onToggle: () => void;
}) {
  const Chevron = expanded ? ChevronDown : ChevronRight;
  return (
    <li key={`group-${heading}`} role="presentation">
      <button
        type="button"
        id={headerId}
        aria-expanded={expanded}
        onMouseEnter={() => onHighlight(rowIndex)}
        onClick={onToggle}
        className={`flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm font-medium text-slate-700 transition-colors hover:bg-slate-100 ${
          highlight === rowIndex ? 'bg-slate-100' : ''
        } ${expanded ? 'bg-slate-50' : ''}`}
      >
        <Chevron className="h-4 w-4 shrink-0 text-slate-400" aria-hidden="true" />
        <span className="min-w-0 flex-1 whitespace-normal break-words uppercase tracking-wide">
          {heading.toUpperCase()}
        </span>
      </button>
    </li>
  );
}

export function SearchableSelect({  ariaLabel,
  placeholder,
  options,
  value,
  onChange,
  disabled = false,
  className = 'w-full rounded-lg border border-slate-300 bg-card py-2 pl-3 pr-8 text-sm',
  emptyText = 'No matching options',
  expandableGroups = false,
  openUpward = false,
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
  // Manually expanded group heading (accordion: at most one). Only used with
  // `expandableGroups`; searching auto-expands every matching group instead,
  // and clearing the search restores the collapsed list.
  const [expandedGroup, setExpandedGroup] = useState<string | null>(null);
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

  // Grouped menu model, derived from the FILTERED options so searching hides
  // empty groups automatically. Headings follow first-seen order; `Other`
  // (options without a group) is always pinned last. `flat` preserves the
  // filtered order for highlight/keyboard indexing.
  // With `expandableGroups` the grouped model is always on (options without
  // a group collect under `Other`), so the collapsed country list works even
  // when no option carries an explicit group.
  const grouped = useMemo(() => {
    const enabled =
      expandableGroups || options.some((option) => (option.group ?? '').trim() !== '');
    if (!enabled) return null;
    const order: string[] = [];
    const byGroup = new Map<string, typeof filtered>();
    for (const option of filtered) {
      const heading = (option.group ?? '').trim() || SEARCHABLE_SELECT_OTHER_GROUP;
      if (!byGroup.has(heading)) {
        byGroup.set(heading, []);
        order.push(heading);
      }
      byGroup.get(heading)!.push(option);
    }
    const headings = [
      ...order.filter((heading) => heading !== SEARCHABLE_SELECT_OTHER_GROUP),
      ...(byGroup.has(SEARCHABLE_SELECT_OTHER_GROUP) ? [SEARCHABLE_SELECT_OTHER_GROUP] : []),
    ];
    return { headings, byGroup };
  }, [filtered, options]);

  const isSearching = query.trim() !== '';
  // Visible menu rows. Without `expandableGroups` every filtered option shows
  // (grouped or flat — exactly the previous behavior). With it, an empty
  // query shows only the collapsed country rows; a query auto-expands every
  // group that still has matches.
  const visibleRows: SelectMenuRow[] = useMemo(() => {
    if (!grouped || !expandableGroups) {
      return filtered.map((option, flatIndex) => ({
        kind: 'option' as const,
        key: `${option.value}__${option.label}`,
        id: `${listboxId}-${flatIndex}`,
        option,
        flatIndex,
      }));
    }
    const rows: SelectMenuRow[] = [];
    for (const heading of grouped.headings) {
      const groupOptions = grouped.byGroup.get(heading)!;
      if (!groupOptions.length) continue;
      const expanded = isSearching ? true : expandedGroup === heading;
      rows.push({
        kind: 'header' as const,
        key: `group-${heading}`,
        id: `${listboxId}-header-${grouped.headings.indexOf(heading)}`,
        heading,
        expanded,
      });
      if (expanded) {
        for (const option of groupOptions) {
          const flatIndex = filtered.indexOf(option);
          rows.push({
            kind: 'option' as const,
            key: `${option.value}__${option.label}`,
            id: `${listboxId}-${flatIndex}`,
            option,
            flatIndex,
          });
        }
      }
    }
    return rows;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtered, grouped, expandableGroups, expandedGroup, isSearching, listboxId]);

  // Accordion toggle: expanding one country collapses the previous.
  // Highlight stays on the toggled header; nothing is selected.
  const toggleExpand = (heading: string) => {
    const rowIndex = visibleRows.findIndex(
      (row) => row.kind === 'header' && row.heading === heading,
    );
    setExpandedGroup((current) => (current === heading ? null : heading));
    if (rowIndex >= 0) setHighlight(rowIndex);
  };

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
  // The menu also grows (up to the viewport width) to fit the longest option
  // label so full names stay visible instead of being cut off; anything
  // longer still wraps inside its row (see the option button below).
  //
  // Horizontal stability: left/width are (re)calculated only when the menu
  // opens, when the option content genuinely changes, or on window scroll /
  // resize. Searching, expanding/collapsing groups, highlighting, selecting
  // and option-array identity churn must never move the menu: content edits
  // keep the anchored geometry instead of retriggering the measurement.
  const liveOptionsRef = useRef<{ options: SearchableSelectOption[]; rowCount: number }>({
    options,
    rowCount: filtered.length,
  });
  liveOptionsRef.current = { options, rowCount: filtered.length };
  // Signature of the option CONTENT (not array identity): a background
  // refetch that returns the same destinations must not reposition anything,
  // while genuinely new content deliberately re-fits the menu once.
  const contentSignature = useMemo(() => {
    let longest = 0;
    for (const option of options) longest = Math.max(longest, option.label.length);
    return `${options.length}:${longest}`;
  }, [options]);
  const updateMenuPosition = useCallback(() => {
    const anchor = inputRef.current;
    if (!anchor) return;
    const { options: liveOptions, rowCount } = liveOptionsRef.current;
    const rect = anchor.getBoundingClientRect();
    const longestLabel = liveOptions.reduce(
      (max, option) => Math.max(max, option.label.length),
      0,
    );
    const contentWidth = longestLabel * 7.5 + 56;
    const viewportPadding = 8;
    const maxWidth = Math.max(176, window.innerWidth - viewportPadding * 2);
    const menuWidth = Math.min(maxWidth, Math.max(rect.width, 176, contentWidth));
    const estimatedHeight = Math.min(288, rowCount * 36 + 8);
    const measuredHeight = menuRef.current?.offsetHeight;
    const needed = measuredHeight && measuredHeight > 0 ? measuredHeight : estimatedHeight;
    const spaceBelow = window.innerHeight - rect.bottom - viewportPadding;
    const spaceAbove = rect.top - viewportPadding;
    const shouldFlip = spaceBelow < needed && spaceAbove > spaceBelow;
    let top: number;
    let maxHeight: number;
    if (openUpward) {
      // Upward-only dropdowns (e.g. itinerary destinations) never open
      // below: the menu bottom sits a small gap above the input top, and
      // limited space above shrinks the menu instead of flipping it.
      maxHeight = Math.min(288, spaceAbove - 4);
      const height = Math.min(needed, maxHeight);
      top = rect.top - height - 4;
    } else if (shouldFlip) {
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openUpward]);

  useLayoutEffect(() => {
    if (open) updateMenuPosition();
  }, [open, contentSignature, updateMenuPosition]);

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
    // The focus below must not reopen the menu (same guard as commit):
    // `onChange('')` hasn't committed yet, so an unguarded focus would seed
    // the query from the stale selection and pop the list back open.
    justCommitted.current = true;
    inputRef.current?.focus();
    justCommitted.current = false;
  };

  // While the user is typing show the query; otherwise show the selection.
  // `open` (not `query` truthiness) decides: an empty query while open must
  // stay empty so clearing/backspacing to nothing never snaps back to the old
  // selection, and typing right after a clear starts from ''. When closed the
  // committed selection is shown. `query` is synced to the selection every
  // time the menu opens so editing starts from the current value.
  // A per-option `selectedLabel` (e.g. a short public name) wins over the
  // full menu label in the closed input; the menu always shows `label`.
  const display = open ? query : (selected?.selectedLabel ?? selected?.label ?? '');

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
          {...(open && visibleRows[highlight]
            ? { 'aria-activedescendant': visibleRows[highlight]!.id }
            : {})}
          disabled={disabled}
          placeholder={placeholder}
          value={display}
          onFocus={() => {
            if (justCommitted.current) return;
            if (!open) {
              // Fresh open: start editing from the current selection so
              // Backspace/middle-edits apply to it and clearing to '' stays
              // empty (display follows `query` while open).
              setQuery(selected?.label ?? '');
              setOpen(true);
            }
          }}
          onMouseDown={(event) => {
            if (disabled) return;
            if (open) {
              // Toggle closed: keep focus where it is and revert to the
              // committed selection.
              event.preventDefault();
              close();
            } else {
              // Opening via click: seed the query when the field already has
              // focus (no focus event will follow to do it).
              setQuery(selected?.label ?? '');
              setOpen(true);
            }
          }}
          onChange={(event) => {
            setQuery(event.target.value);
            // Clearing the search restores the collapsed country list.
            if (expandableGroups && event.target.value.trim() === '') setExpandedGroup(null);
            setOpen(true);
          }}
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown') {
              event.preventDefault();
              if (!open) {
                setQuery(selected?.label ?? '');
                setOpen(true);
              } else if (visibleRows.length)
                setHighlight((row) => (row + 1) % visibleRows.length);
            } else if (event.key === 'ArrowUp') {
              event.preventDefault();
              if (visibleRows.length)
                setHighlight((row) => (row - 1 + visibleRows.length) % visibleRows.length);
            } else if (event.key === 'Enter') {
              event.preventDefault();
              const row = visibleRows[highlight];
              if (!open || !row) return;
              if (row.kind === 'header') toggleExpand(row.heading);
              else commit(row.option);
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
            {grouped && !expandableGroups
              ? grouped.headings.map((heading) => (
                  <li key={`group-${heading}`} role="presentation">
                    <div
                      aria-hidden="true"
                      className="select-none px-3 pb-0.5 pt-2 text-[11px] font-semibold uppercase tracking-wider text-slate-400"
                    >
                      {heading.toUpperCase()}
                    </div>
                    <ul>
                      {grouped.byGroup.get(heading)!.map((option) => (
                        <OptionRow
                          key={`${option.value}__${option.label}`}
                          option={option}
                          rowIndex={filtered.indexOf(option)}
                          optionId={`${listboxId}-${filtered.indexOf(option)}`}
                          highlight={highlight}
                          selected={selected}
                          value={value}
                          onHighlight={setHighlight}
                          onCommit={commit}
                        />
                      ))}
                    </ul>
                  </li>
                ))
              : visibleRows.map((row, rowIndex) =>
                  row.kind === 'header' ? (
                    <CountryRow
                      key={row.key}
                      heading={row.heading}
                      expanded={row.expanded}
                      rowIndex={rowIndex}
                      headerId={row.id}
                      highlight={highlight}
                      onHighlight={setHighlight}
                      onToggle={() => toggleExpand(row.heading)}
                    />
                  ) : (
                    <OptionRow
                      key={row.key}
                      option={row.option}
                      rowIndex={rowIndex}
                      optionId={row.id}
                      highlight={highlight}
                      selected={selected}
                      value={value}
                      indent={grouped != null}
                      onHighlight={setHighlight}
                      onCommit={commit}
                    />
                  ),
                )}
          </ul>,
          document.body,
        )}
    </div>
  );
}
