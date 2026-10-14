import { describe, expect, it, vi } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { useState } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TimePicker, formatStoredTime, parseTime24, toTime24 } from './TimePicker';
import { computeDuration } from '../../pages/quotations/QuotationBuilderPage';

function renderPicker(initialValue: string | null = null, onChange = vi.fn()) {
  function Harness() {
    const [value, setValue] = useState<string | null>(initialValue);
    return (
      <form
        onSubmit={(event) => {
          event.preventDefault();
          (window as unknown as { __submitted?: boolean }).__submitted = true;
        }}
      >
        <TimePicker
          ariaLabel="Departure Time"
          value={value}
          onChange={(next) => {
            setValue(next);
            onChange(next);
          }}
        />
      </form>
    );
  }
  const rendered = render(<Harness />);
  delete (window as unknown as { __submitted?: boolean }).__submitted;
  return { ...rendered, onChange, input: screen.getByLabelText('Departure Time') as HTMLInputElement };
}

async function openPicker(input: HTMLElement) {
  await userEvent.click(input);
  await screen.findByRole('dialog', { name: 'Departure Time picker' });
}

describe('TimePicker helpers', () => {
  it('parses and formats 24-hour values without timezone shifts', () => {
    expect(parseTime24('13:00')).toEqual({ hour24: 13, minute: 0 });
    expect(parseTime24('00:00')).toEqual({ hour24: 0, minute: 0 });
    expect(parseTime24('12:00')).toEqual({ hour24: 12, minute: 0 });
    expect(parseTime24(null)).toBeNull();
    expect(parseTime24('')).toBeNull();
    expect(parseTime24('nope')).toBeNull();
    expect(parseTime24('24:00')).toBeNull();
    expect(formatStoredTime('13:00')).toBe('01:00 PM');
    expect(formatStoredTime('00:00')).toBe('12:00 AM');
    expect(formatStoredTime('12:00')).toBe('12:00 PM');
    expect(formatStoredTime(null)).toBe('');
    expect(toTime24(12, 0, 'AM')).toBe('00:00');
    expect(toTime24(12, 0, 'PM')).toBe('12:00');
    expect(toTime24(1, 5, 'PM')).toBe('13:05');
  });
});

describe('TimePicker columns', () => {
  it('renders aligned Hour, Minute and AM/PM columns with uniform rows', async () => {
    const { input } = renderPicker('10:00');
    expect(input).toHaveValue('10:00 AM');
    await openPicker(input);

    for (const name of ['Departure Time hour', 'Departure Time minute', 'Departure Time AM or PM']) {
      expect(screen.getByRole('listbox', { name })).toBeInTheDocument();
    }
    expect(screen.getByText('Hour')).toBeInTheDocument();
    expect(screen.getByText('Minute')).toBeInTheDocument();
    expect(screen.getByText('AM/PM')).toBeInTheDocument();
    // 12 hours + 60 minutes + 2 periods with identical row geometry.
    expect(screen.getAllByRole('option')).toHaveLength(74);
    for (const row of screen.getAllByRole('option')) {
      const classes = row.getAttribute('class') ?? '';
      for (const token of ['flex', 'h-8', 'w-full', 'items-center', 'justify-center', 'px-2']) {
        expect(classes.split(/\s+/)).toContain(token);
      }
      expect(classes).not.toMatch(/translate/);
    }
  });

  it('selects hour, minute and period, committing 24-hour values', async () => {
    const { input, onChange } = renderPicker(null);
    expect(input).toHaveValue('');
    await openPicker(input);

    await userEvent.click(screen.getByRole('option', { name: 'Hour 01' }));
    expect(onChange).toHaveBeenLastCalledWith('01:00');
    expect(input).toHaveValue('01:00 AM');

    await userEvent.click(screen.getByRole('option', { name: 'Minute 15' }));
    expect(onChange).toHaveBeenLastCalledWith('01:15');
    expect(input).toHaveValue('01:15 AM');

    // AM/PM is the final step and closes the popup.
    await userEvent.click(screen.getByRole('option', { name: 'AM/PM PM' }));
    expect(onChange).toHaveBeenLastCalledWith('13:15');
    expect(input).toHaveValue('01:15 PM');
    expect(
      screen.queryByRole('dialog', { name: 'Departure Time picker' }),
    ).not.toBeInTheDocument();
  });

  it('handles noon and midnight correctly', async () => {
    const first = renderPicker('00:00');
    expect(first.input).toHaveValue('12:00 AM');
    await openPicker(first.input);
    expect(screen.getByRole('option', { name: 'Hour 12' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(screen.getByRole('option', { name: 'AM/PM AM' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    first.unmount();

    const second = renderPicker('12:00');
    expect(second.input).toHaveValue('12:00 PM');
    await openPicker(second.input);
    expect(screen.getByRole('option', { name: 'AM/PM PM' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    second.unmount();

    // Picking 12 AM from empty stores midnight.
    const third = renderPicker(null, vi.fn());
    await openPicker(third.input);
    await userEvent.click(screen.getByRole('option', { name: 'Hour 12' }));
    await userEvent.click(screen.getByRole('option', { name: 'AM/PM AM' }));
    expect(third.onChange).toHaveBeenLastCalledWith('00:00');
    expect(third.input).toHaveValue('12:00 AM');
    third.unmount();
  });

  it('reopening reflects the existing time selection', async () => {
    const { input } = renderPicker('13:00');
    await openPicker(input);
    expect(screen.getByRole('option', { name: 'Hour 01' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(screen.getByRole('option', { name: 'Minute 00' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(screen.getByRole('option', { name: 'AM/PM PM' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
  });

  it('supports keyboard interaction and outside-click dismissal', async () => {
    const { input, onChange } = renderPicker(null);
    await userEvent.click(input);
    await screen.findByRole('dialog', { name: 'Departure Time picker' });

    // ArrowDown highlights + commits the first hour, starting empty.
    fireEvent.keyDown(screen.getByRole('listbox', { name: 'Departure Time hour' }).parentElement!, {
      key: 'ArrowDown',
    });
    expect(onChange).toHaveBeenLastCalledWith('01:00');

    // Escape closes and keeps the committed value.
    fireEvent.keyDown(screen.getByRole('dialog', { name: 'Departure Time picker' }), {
      key: 'Escape',
    });
    expect(
      screen.queryByRole('dialog', { name: 'Departure Time picker' }),
    ).not.toBeInTheDocument();
    expect(input).toHaveValue('01:00 AM');

    // Outside click dismisses without changing the value.
    await openPicker(input);
    fireEvent.mouseDown(document.body);
    expect(
      screen.queryByRole('dialog', { name: 'Departure Time picker' }),
    ).not.toBeInTheDocument();
    expect(input).toHaveValue('01:00 AM');
  });

  it('opens with Enter and never submits the surrounding form', async () => {
    const { input, onChange } = renderPicker('10:00');
    await userEvent.click(input);
    await userEvent.keyboard('{Escape}');
    input.focus();
    await userEvent.keyboard('{Enter}');
    await screen.findByRole('dialog', { name: 'Departure Time picker' });
    // Keyboard opening moves focus to the selected hour.
    await waitFor(() =>
      expect(screen.getByRole('option', { name: 'Hour 10' })).toHaveFocus(),
    );

    // Enter on a highlighted option commits and closes without submitting.
    await userEvent.keyboard('{ArrowDown}');
    await userEvent.keyboard('{Enter}');
    expect(
      screen.queryByRole('dialog', { name: 'Departure Time picker' }),
    ).not.toBeInTheDocument();
    expect((window as unknown as { __submitted?: boolean }).__submitted).toBeUndefined();
    expect(onChange).toHaveBeenCalled();
  });

  it('keeps two pickers independent', async () => {    function Two() {
      const [a, setA] = useState<string | null>('10:00');
      const [b, setB] = useState<string | null>('14:00');
      return (
        <>
          <TimePicker ariaLabel="Departure Time" value={a} onChange={setA} />
          <TimePicker ariaLabel="Arrival Time" value={b} onChange={setB} />
        </>
      );
    }
    render(<Two />);
    const departure = screen.getByLabelText('Departure Time') as HTMLInputElement;
    const arrival = screen.getByLabelText('Arrival Time') as HTMLInputElement;
    expect(departure).toHaveValue('10:00 AM');
    expect(arrival).toHaveValue('02:00 PM');

    await userEvent.click(departure);
    await screen.findByRole('dialog', { name: 'Departure Time picker' });
    await userEvent.click(screen.getByRole('option', { name: 'Hour 11' }));
    expect(departure).toHaveValue('11:00 AM');
    expect(arrival).toHaveValue('02:00 PM');
  });

  it('preserves duration math on picked 24-hour values', () => {
    expect(computeDuration('2026-01-01', '13:00', '2026-01-01', '14:30')).toBe('1h 30m');
    expect(computeDuration('2026-01-01', '00:00', '2026-01-01', '12:00')).toBe('12h 0m');
    expect(computeDuration('2026-01-01', '23:00', '2026-01-02', '01:00')).toBe('2h 0m');
  });

  it('applies slim scrollbars to Hour and Minute columns only', async () => {
    const { input } = renderPicker('10:00');
    await openPicker(input);

    const hour = screen.getByRole('listbox', { name: 'Departure Time hour' });
    const minute = screen.getByRole('listbox', { name: 'Departure Time minute' });
    const period = screen.getByRole('listbox', { name: 'Departure Time AM or PM' });
    // Scrollable columns carry the slim-scrollbar class; the short AM/PM
    // column keeps native scrollbars.
    expect(hour.className).toContain('time-picker-scroll');
    expect(minute.className).toContain('time-picker-scroll');
    expect(period.className).not.toContain('time-picker-scroll');
    // Scrolling itself is untouched.
    for (const column of [hour, minute]) {
      expect(column.className).toContain('overflow-y-auto');
    }
  });
});

describe('TimePicker scrollbar styles', () => {
  const candidates = [
    resolve(process.cwd(), 'src/index.css'),
    resolve(process.cwd(), 'apps/web/src/index.css'),
  ];
  const cssPath = candidates.find((candidate) => existsSync(candidate)) ?? candidates[0]!;
  const css = readFileSync(cssPath, 'utf8');

  it('styles a slim 4px scrollbar with a neutral thumb and transparent track', () => {
    const block = css.match(/\.time-picker-scroll::-webkit-scrollbar\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(block).toMatch(/width:\s*4px/);
    const thumb = css.match(/\.time-picker-scroll::-webkit-scrollbar-thumb\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(thumb).toMatch(/border-radius/);
    const track = css.match(/\.time-picker-scroll::-webkit-scrollbar-track\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(track).toMatch(/transparent/);
  });

  it('darkens only the thumb colour on hover without changing its width', () => {
    const hover = css.match(/\.time-picker-scroll::-webkit-scrollbar-thumb:hover\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(hover).not.toMatch(/width/);
    expect(hover).toMatch(/background/);
  });

  it('keeps a Firefox fallback for thin scrollbars', () => {
    const base = css.match(/\.time-picker-scroll\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(base).toMatch(/scrollbar-width:\s*thin/);
    expect(base).toMatch(/scrollbar-color/);
  });
});
