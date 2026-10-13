import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SearchableSelect } from './SearchableSelect';

const OPTIONS = [
  { value: 'Mumbai', label: 'Mumbai' },
  { value: 'Delhi', label: 'Delhi' },
  { value: 'Chennai', label: 'Chennai' },
  { value: 'Germany', label: 'Germany' },
];

function renderSelect(initialValue = '', onChange = vi.fn()) {
  function Harness() {
    const [value, setValue] = useState(initialValue);
    return (
      <SearchableSelect
        ariaLabel="Test field"
        placeholder="Select option"
        options={OPTIONS}
        value={value}
        onChange={(next) => {
          setValue(next);
          onChange(next);
        }}
      />
    );
  }
  render(<Harness />);
  return { onChange, input: screen.getByLabelText('Test field') as HTMLInputElement };
}

describe('SearchableSelect search regression', () => {
  it('filters as characters are typed', async () => {
    const { input } = renderSelect();
    await userEvent.click(input);
    fireEvent.change(input, { target: { value: 'del' } });
    expect(screen.getByRole('option', { name: 'Delhi' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'Mumbai' })).not.toBeInTheDocument();
    expect(input).toHaveValue('del');
  });

  it('updates results when the last character is deleted with Backspace', async () => {
    const { input } = renderSelect('Mumbai');
    expect(input).toHaveValue('Mumbai');
    await userEvent.click(input);
    // Editing starts from the selection: "Mumbai" -> "Mumba".
    fireEvent.change(input, { target: { value: 'Mumba' } });
    expect(input).toHaveValue('Mumba');
    expect(screen.getByRole('option', { name: 'Mumbai' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'Delhi' })).not.toBeInTheDocument();
  });

  it('updates results when multiple characters are deleted', async () => {
    const { input } = renderSelect('Chennai');
    await userEvent.click(input);
    fireEvent.change(input, { target: { value: 'Chenna' } });
    expect(screen.getByRole('option', { name: 'Chennai' })).toBeInTheDocument();
    fireEvent.change(input, { target: { value: 'Che' } });
    expect(screen.getByRole('option', { name: 'Chennai' })).toBeInTheDocument();
    expect(input).toHaveValue('Che');
  });

  it('supports edits in the middle of the query', async () => {
    const { input } = renderSelect();
    await userEvent.click(input);
    fireEvent.change(input, { target: { value: 'Delh' } });
    expect(screen.getByRole('option', { name: 'Delhi' })).toBeInTheDocument();
    // Insert in the middle: "Delh" -> "Delhi" is covered; simulate a middle
    // replacement that still matches Delhi and nothing else.
    fireEvent.change(input, { target: { value: 'Delhi' } });
    expect(input).toHaveValue('Delhi');
    expect(screen.getByRole('option', { name: 'Delhi' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'Chennai' })).not.toBeInTheDocument();
  });

  it('stays empty (showing every option) when the whole search is cleared', async () => {
    const { input } = renderSelect('Mumbai');
    await userEvent.click(input);
    fireEvent.change(input, { target: { value: '' } });
    // Must not snap back to the old selection while open.
    expect(input).toHaveValue('');
    expect(screen.getByRole('option', { name: 'Mumbai' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Delhi' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Chennai' })).toBeInTheDocument();
  });

  it('starts a fresh search immediately after clearing', async () => {
    const { input } = renderSelect('Mumbai');
    await userEvent.click(input);
    fireEvent.change(input, { target: { value: '' } });
    expect(input).toHaveValue('');
    fireEvent.change(input, { target: { value: 'Delhi' } });
    expect(input).toHaveValue('Delhi');
    expect(screen.getByRole('option', { name: 'Delhi' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'Mumbai' })).not.toBeInTheDocument();
  });

  it('selects a result with the mouse', async () => {
    const onChange = vi.fn();
    const { input } = renderSelect('', onChange);
    await userEvent.click(input);
    fireEvent.change(input, { target: { value: 'chenn' } });
    await userEvent.click(screen.getByRole('option', { name: 'Chennai' }));
    expect(onChange).toHaveBeenCalledWith('Chennai');
    expect(input).toHaveValue('Chennai');
    expect(
      screen.queryByRole('listbox', { name: 'Test field search results' }),
    ).not.toBeInTheDocument();
  });

  it('supports keyboard search and selection plus Escape', async () => {
    const onChange = vi.fn();
    const { input } = renderSelect('', onChange);
    await userEvent.click(input);
    fireEvent.change(input, { target: { value: 'german' } });
    await userEvent.keyboard('{ArrowDown}{Enter}');
    expect(onChange).toHaveBeenCalledWith('Germany');
    expect(input).toHaveValue('Germany');

    await userEvent.click(input);
    expect(
      screen.getByRole('listbox', { name: 'Test field search results' }),
    ).toBeInTheDocument();
    await userEvent.keyboard('{Escape}');
    expect(
      screen.queryByRole('listbox', { name: 'Test field search results' }),
    ).not.toBeInTheDocument();
    expect(input).toHaveValue('Germany');
  });

  it('reopens on the selection after close and allows a new search', async () => {
    const onChange = vi.fn();
    const { input } = renderSelect('', onChange);
    await userEvent.click(input);
    fireEvent.change(input, { target: { value: 'delh' } });
    await userEvent.click(screen.getByRole('option', { name: 'Delhi' }));
    expect(input).toHaveValue('Delhi');
    // Commit closes the menu.
    expect(
      screen.queryByRole('listbox', { name: 'Test field search results' }),
    ).not.toBeInTheDocument();

    // Reopen: the selection is shown again with the full list.
    await userEvent.click(input);
    expect(input).toHaveValue('Delhi');
    expect(
      screen.getByRole('listbox', { name: 'Test field search results' }),
    ).toBeInTheDocument();

    // Toggle closed: reverts to the committed selection.
    await userEvent.click(input);
    expect(
      screen.queryByRole('listbox', { name: 'Test field search results' }),
    ).not.toBeInTheDocument();
    expect(input).toHaveValue('Delhi');

    // Reopen once more and run a new search.
    await userEvent.click(input);
    expect(
      screen.getByRole('listbox', { name: 'Test field search results' }),
    ).toBeInTheDocument();

    // A new query from the reopened state filters correctly.
    fireEvent.change(input, { target: { value: 'Mumbai' } });
    expect(screen.getByRole('option', { name: 'Mumbai' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'Delhi' })).not.toBeInTheDocument();
  });

  it('clears the value with the clear button and accepts a new search', async () => {
    const onChange = vi.fn();
    const { input } = renderSelect('Delhi', onChange);
    await userEvent.click(screen.getByLabelText('Clear Test field'));
    expect(onChange).toHaveBeenCalledWith('');
    expect(input).toHaveValue('');
  });
});

describe('SearchableSelect menu anchoring', () => {
  const GROUPED = [
    { value: 'Kashmir 6N/7D', label: 'Kashmir 6N/7D', group: 'India' },
    {
      value: 'Malaysia Hub',
      label:
        'Malaysia - Langkawi & Kuala Lumpur with a very long trailing suffix that keeps going — Malaysia Private Label',
      group: 'Malaysia',
    },
    { value: 'Singapore', label: 'Singapore', group: 'Singapore' },
  ];
  const LISTBOX = 'Anchor field search results';
  const originalRect = window.HTMLElement.prototype.getBoundingClientRect;
  const originalInnerWidth = window.innerWidth;

  function mockGeometry() {
    Object.defineProperty(window, 'innerWidth', { value: 1280, configurable: true });
    window.HTMLElement.prototype.getBoundingClientRect = function () {
      if ((this as HTMLElement).getAttribute?.('role') === 'combobox')
        return {
          x: 700, y: 200, left: 700, top: 200, right: 950, bottom: 238,
          width: 250, height: 38, toJSON: () => ({}),
        } as DOMRect;
      return originalRect.call(this);
    };
  }

  function renderAnchored(optionalOptions = GROUPED) {
    function Harness({ items }: { items?: typeof GROUPED }) {
      const [value, setValue] = useState('');
      return (
        <SearchableSelect
          ariaLabel="Anchor field"
          placeholder="Select option"
          options={items ?? optionalOptions}
          expandableGroups
          value={value}
          onChange={setValue}
        />
      );
    }
    const rendered = render(<Harness />);
    return {
      ...rendered,
      input: screen.getByLabelText('Anchor field') as HTMLInputElement,
      rerenderWith: (items: typeof GROUPED) => rendered.rerender(<Harness items={items} />),
    };
  }

  const geometry = () => {
    const menu = screen.queryByRole('listbox', { name: LISTBOX });
    return menu ? { left: menu.style.left, width: menu.style.width } : null;
  };

  // Deliberate anchor math mirrored from the component: fit the longest
  // label, clamp into the viewport, align to the input's left edge.
  const expectedAnchor = (labels: string[]) => {
    const longest = Math.max(...labels.map((label) => label.length));
    const width = Math.min(1280 - 16, Math.max(250, 176, longest * 7.5 + 56));
    const left = 700 + width > 1280 - 8 ? 1280 - width - 8 : 700;
    return { left: `${left}px`, width: `${width}px` };
  };
  const anchoredTo = (labels: string[]) => expect(geometry()).toEqual(expectedAnchor(labels));
  const groupLabels = GROUPED.map((option) => option.label);

  beforeEach(() => {
    mockGeometry();
  });

  afterEach(() => {
    window.HTMLElement.prototype.getBoundingClientRect = originalRect;
    Object.defineProperty(window, 'innerWidth', { value: originalInnerWidth, configurable: true });
  });

  it('anchors to the input and never moves on expand, collapse, search, clear or reselect', async () => {
    const { input } = renderAnchored();
    await userEvent.click(input);
    await screen.findByRole('listbox', { name: LISTBOX });
    // Wide menu clamped deliberately against the viewport edge.
    anchoredTo(groupLabels);

    await userEvent.click(screen.getByRole('button', { name: 'MALAYSIA' }));
    anchoredTo(groupLabels);

    await userEvent.click(screen.getByRole('button', { name: 'MALAYSIA' }));
    anchoredTo(groupLabels);

    fireEvent.change(input, { target: { value: 'langkawi' } });
    anchoredTo(groupLabels);

    fireEvent.change(input, { target: { value: '' } });
    anchoredTo(groupLabels);

    // Selecting closes; reopening restores the identical anchor.
    await userEvent.click(screen.getByRole('button', { name: 'MALAYSIA' }));
    await userEvent.click(
      screen.getByRole('option', {
        name: 'Malaysia - Langkawi & Kuala Lumpur with a very long trailing suffix that keeps going — Malaysia Private Label',
      }),
    );
    expect(screen.queryByRole('listbox', { name: LISTBOX })).not.toBeInTheDocument();
    await userEvent.click(input);
    await screen.findByRole('listbox', { name: LISTBOX });
    anchoredTo(groupLabels);
  });

  it('ignores options identity churn but re-fits deliberate content changes', async () => {
    const { input, rerenderWith } = renderAnchored();
    await userEvent.click(input);
    await screen.findByRole('listbox', { name: LISTBOX });
    const before = expectedAnchor(groupLabels);
    anchoredTo(groupLabels);

    // Same destinations, brand-new array (e.g. background refetch): no move.
    rerenderWith(GROUPED.map((option) => ({ ...option })));
    expect(geometry()).toEqual(before);

    // Genuinely longer content re-fits once, still clamped into the viewport.
    const longer = 'Malaysia - Langkawi & Kuala Lumpur with a very long trailing suffix that keeps going and going — Malaysia Private Label Extended';
    rerenderWith([
      ...GROUPED.map((option) => ({ ...option })),
      { value: 'Extra', label: longer, group: 'Malaysia' },
    ]);
    const next = geometry();
    expect(next).not.toBeNull();
    expect(Number.parseFloat(next!.width)).toBeGreaterThan(Number.parseFloat(before.width));
    // Deliberate clamp: left edge = viewport - width - padding.
    expect(Number.parseFloat(next!.left)).toBeCloseTo(
      1280 - Number.parseFloat(next!.width) - 8,
      0,
    );
    const menu = screen.getByRole('listbox', { name: LISTBOX });
    expect(Number.parseFloat(menu.style.left)).toBeGreaterThanOrEqual(8);
    expect(Number.parseFloat(menu.style.left) + Number.parseFloat(menu.style.width)).toBeLessThanOrEqual(
      1280 - 8,
    );
  });
});

describe('SearchableSelect row hover geometry', () => {
  const ROWS = [
    { value: 'Goa Beach Escape', label: 'Goa Beach Escape — opd', group: 'India' },
    { value: 'Kerala Backwaters', label: 'Kerala Backwaters — aaa', group: 'India' },
    { value: 'Singapore', label: 'Singapore', group: 'Singapore' },
  ];

  function renderRows() {
    function Harness() {
      const [value, setValue] = useState('');
      return (
        <SearchableSelect
          ariaLabel="Hover field"
          placeholder="Select option"
          options={ROWS}
          expandableGroups
          value={value}
          onChange={setValue}
        />
      );
    }
    render(<Harness />);
    return screen.getByLabelText('Hover field') as HTMLInputElement;
  }

  /** Class tokens minus background fills: everything that can move layout. */
  const geometryOf = (element: Element | null) =>
    new Set(
      (element?.getAttribute('class') ?? '')
        .split(/\s+/)
        .filter(Boolean)
        .filter((token) => !token.startsWith('bg-')),
    );

  const expectSameGeometry = (before: Set<string>, after: Element | null) => {
    expect([...geometryOf(after)].sort()).toEqual([...before].sort());
  };

  it('hovering a destination changes only its background highlight', async () => {
    const input = renderRows();
    await userEvent.click(input);
    await userEvent.click(screen.getByRole('button', { name: 'INDIA' }));
    const option = screen.getByRole('option', { name: 'Goa Beach Escape — opd' });
    const before = geometryOf(option);

    fireEvent.mouseEnter(option);
    expect(option.getAttribute('class')).toContain('bg-slate-100');
    // Every other class token is identical: no padding, margin,
    // border, transform or alignment change — the row cannot move.
    expectSameGeometry(before, option);
    expect(option.textContent).toContain('Goa Beach Escape — opd');
  });

  it('keeps identical indentation across destinations in one country', async () => {
    const input = renderRows();
    await userEvent.click(input);
    await userEvent.click(screen.getByRole('button', { name: 'INDIA' }));
    const goa = screen.getByRole('option', { name: 'Goa Beach Escape — opd' });
    const kerala = screen.getByRole('option', { name: 'Kerala Backwaters — aaa' });
    const paddingOf = (element: Element) =>
      (element.getAttribute('class') ?? '')
        .split(/\s+/)
        .filter((token) => /^(p[xytrbl]?|m[xytrbl]?)-/.test(token))
        .sort();
    // Explicit identical indentation (no cascade-dependent px/pl conflict).
    expect(paddingOf(goa)).toEqual(paddingOf(kerala));
    expect(paddingOf(goa)).toContain('pl-9');
    expect(paddingOf(goa)).not.toContain('px-3');
    // Hovering one row leaves its sibling's geometry untouched too.
    fireEvent.mouseEnter(goa);
    expect(paddingOf(kerala)).toEqual(paddingOf(goa));
  });

  it('keyboard highlight preserves the same geometry as hover', async () => {
    const input = renderRows();
    await userEvent.click(input);
    // Enter expands the first country (highlight starts on its header).
    await userEvent.keyboard('{Enter}');
    const option = screen.getByRole('option', { name: 'Goa Beach Escape — opd' });
    const unhighlighted = geometryOf(option);

    // ArrowDown highlights the first destination via keyboard.
    await userEvent.keyboard('{ArrowDown}');
    expect(option.getAttribute('class')).toContain('bg-slate-100');
    expectSameGeometry(unhighlighted, option);
  });

  it('country headers are stable on hover and keep expand behavior', async () => {
    const input = renderRows();
    await userEvent.click(input);
    const header = screen.getByRole('button', { name: 'INDIA' });
    const before = geometryOf(header);

    fireEvent.mouseEnter(header);
    expect(header.getAttribute('class')).toContain('bg-slate-100');
    expectSameGeometry(before, header);

    // Chevron still indicates state and toggling still works.
    expect(header).toHaveAttribute('aria-expanded', 'false');
    await userEvent.click(header);
    expect(header).toHaveAttribute('aria-expanded', 'true');
    expect(
      screen.getByRole('option', { name: 'Goa Beach Escape — opd' }),
    ).toBeInTheDocument();
    await userEvent.click(header);
    expect(header).toHaveAttribute('aria-expanded', 'false');
    expect(
      screen.queryByRole('option', { name: 'Goa Beach Escape — opd' }),
    ).not.toBeInTheDocument();
  });
});

describe('SearchableSelect upward-only positioning', () => {
  const UP_OPTIONS = [
    { value: 'Goa Beach Escape', label: 'Goa Beach Escape — opd', selectedLabel: 'Goa Beach Escape', group: 'India' },
    { value: 'Kerala Backwaters', label: 'Kerala Backwaters — aaa', selectedLabel: 'Kerala Backwaters', group: 'India' },
    { value: 'Singapore', label: 'Singapore', selectedLabel: 'Singapore', group: 'Singapore' },
  ];
  const UP_LISTBOX = 'Upward field search results';
  const originalRect = window.HTMLElement.prototype.getBoundingClientRect;
  const originalInnerHeight = window.innerHeight;

  function mockViewport(rectTop: number) {
    Object.defineProperty(window, 'innerHeight', { value: 800, configurable: true });
    window.HTMLElement.prototype.getBoundingClientRect = function () {
      if ((this as HTMLElement).getAttribute?.('role') === 'combobox')
        return {
          x: 100, y: rectTop, left: 100, top: rectTop, right: 350, bottom: rectTop + 38,
          width: 250, height: 38, toJSON: () => ({}),
        } as DOMRect;
      return originalRect.call(this);
    };
  }

  function renderUpward() {
    function Harness() {
      const [value, setValue] = useState('');
      return (
        <SearchableSelect
          ariaLabel="Upward field"
          placeholder="Select option"
          options={UP_OPTIONS}
          expandableGroups
          openUpward
          value={value}
          onChange={setValue}
        />
      );
    }
    render(<Harness />);
    return screen.getByLabelText('Upward field') as HTMLInputElement;
  }

  const menuStyle = () => {
    const menu = screen.queryByRole('listbox', { name: UP_LISTBOX });
    return menu
      ? { top: menu.style.top, maxHeight: menu.style.maxHeight, left: menu.style.left }
      : null;
  };

  afterEach(() => {
    window.HTMLElement.prototype.getBoundingClientRect = originalRect;
    Object.defineProperty(window, 'innerHeight', { value: originalInnerHeight, configurable: true });
  });

  it('always opens above the input, including on reopen after selection', async () => {
    mockViewport(600);
    const input = renderUpward();
    await userEvent.click(input);
    await screen.findByRole('listbox', { name: UP_LISTBOX });
    // 3 collapsed rows: needed = 3*36+8 = 116; top = 600-116-4.
    expect(menuStyle()).toMatchObject({ top: '480px', maxHeight: '288px' });

    // Selecting closes; reopening uses the same upward position.
    await userEvent.click(screen.getByRole('button', { name: 'INDIA' }));
    await userEvent.click(screen.getByRole('option', { name: 'Goa Beach Escape — opd' }));
    expect(screen.queryByRole('listbox', { name: UP_LISTBOX })).not.toBeInTheDocument();
    expect(input).toHaveValue('Goa Beach Escape');
    await userEvent.click(input);
    await screen.findByRole('listbox', { name: UP_LISTBOX });
    // Reopened with the seeded query the menu is shorter, but still above
    // the input — never below it.
    const reopenedTop = Number.parseFloat(menuStyle()!.top);
    expect(reopenedTop).toBeLessThan(600);
    expect(reopenedTop).toBeGreaterThan(0);
  });

  it('searching and expanding never move it below the input', async () => {
    mockViewport(600);
    const input = renderUpward();
    await userEvent.click(input);
    await screen.findByRole('listbox', { name: UP_LISTBOX });
    const anchored = menuStyle();

    fireEvent.change(input, { target: { value: 'goa' } });
    expect(menuStyle()).toEqual(anchored);

    await userEvent.click(screen.getByRole('button', { name: 'INDIA' }));
    expect(menuStyle()).toEqual(anchored);

    fireEvent.change(input, { target: { value: '' } });
    expect(menuStyle()).toEqual(anchored);
    const top = Number.parseFloat(menuStyle()!.top);
    expect(top).toBeLessThan(600);
  });

  it('shrinks to fit limited space above instead of opening below', async () => {
    mockViewport(100);
    const input = renderUpward();
    await userEvent.click(input);
    const menu = await screen.findByRole('listbox', { name: UP_LISTBOX });
    // spaceAbove = 92: maxHeight shrinks (288 cap, 120 floor keeps scrolling).
    expect(menuStyle()).toMatchObject({ top: '8px', maxHeight: '120px' });
    expect(menu.className).toContain('overflow-auto');
    expect(Number.parseFloat(menu.style.top)).toBeLessThan(100);
  });

  it('scroll and resize preserve the upward anchor', async () => {
    mockViewport(600);
    const input = renderUpward();
    await userEvent.click(input);
    await screen.findByRole('listbox', { name: UP_LISTBOX });
    const anchored = menuStyle();

    fireEvent.scroll(window);
    expect(menuStyle()).toEqual(anchored);
    fireEvent(window, new Event('resize'));
    expect(menuStyle()).toEqual(anchored);
  });

  it('dropdowns without the opt-in keep the automatic flip behavior', async () => {
    mockViewport(600);
    function Harness() {
      const [value, setValue] = useState('');
      return (
        <SearchableSelect
          ariaLabel="Default field"
          placeholder="Select option"
          options={UP_OPTIONS}
          expandableGroups
          value={value}
          onChange={setValue}
        />
      );
    }
    render(<Harness />);
    await userEvent.click(screen.getByLabelText('Default field'));
    const menu = await screen.findByRole('listbox', { name: 'Default field search results' });
    // Plenty of space below (needed 116 < 154): opens below the input.
    expect(menu.style.top).toBe('642px');
  });
});
