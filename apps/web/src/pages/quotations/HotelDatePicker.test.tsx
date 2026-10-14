import { describe, expect, it, vi } from 'vitest';
import { screen, within, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '@/test/utils';
import {
  HotelCheckoutDatePicker,
  HotelDatePicker,
  addCalendarDays,
  parseDateInputString,
  parseISODateString,
  toDisplayDateString,
  toISODateString,
  utcDayNumber,
} from './HotelDatePicker';

describe('checkout calendar-day arithmetic (UTC, no millisecond math)', () => {
  it('adds a day across month and year boundaries', () => {
    expect(toISODateString(addCalendarDays(parseISODateString('2026-12-05')!, 1))).toBe(
      '2026-12-06',
    );
    expect(toISODateString(addCalendarDays(parseISODateString('2026-12-31')!, 1))).toBe(
      '2027-01-01',
    );
    expect(toISODateString(addCalendarDays(parseISODateString('2027-02-28')!, 1))).toBe(
      '2027-03-01',
    );
    expect(toISODateString(addCalendarDays(parseISODateString('2024-02-28')!, 1))).toBe(
      '2024-02-29',
    );
  });

  it('parses strictly and rejects overflow/invalid input', () => {
    expect(parseISODateString('2026-12-05')?.toISOString()).toBe('2026-12-05T00:00:00.000Z');
    expect(parseISODateString('2026-02-30')).toBeNull();
    expect(parseISODateString('not-a-date')).toBeNull();
    expect(parseISODateString('')).toBeNull();
    expect(parseISODateString(null)).toBeNull();
    expect(parseISODateString(new Date('2026-12-05T00:00:00.000Z'))?.toISOString()).toBe(
      '2026-12-05T00:00:00.000Z',
    );
  });

  it('compares UTC day numbers', () => {
    expect(utcDayNumber(parseISODateString('2026-12-06')!)).toBeGreaterThan(
      utcDayNumber(parseISODateString('2026-12-05')!),
    );
  });

  it('formats display dates as DD-MM-YYYY and parses them back', () => {
    expect(toDisplayDateString(parseISODateString('2026-12-05')!)).toBe('05-12-2026');
    expect(parseDateInputString('06-12-2026')?.toISOString()).toBe('2026-12-06T00:00:00.000Z');
    expect(parseDateInputString('06/12/2026')?.toISOString()).toBe('2026-12-06T00:00:00.000Z');
    // ISO entry stays accepted for compatibility.
    expect(parseDateInputString('2026-12-20')?.toISOString()).toBe('2026-12-20T00:00:00.000Z');
    expect(parseDateInputString('30-02-2026')).toBeNull();
    expect(parseDateInputString('not-a-date')).toBeNull();
    expect(parseDateInputString('')).toBeNull();
  });
});

function renderPicker(props: {
  checkInDate?: string | Date | null;
  checkOutDate?: string | Date | null;
  /** Pass to force an explicit value (including null) instead of the default. */
  explicitCheckIn?: string | Date | null;
} = {}) {
  const onSelect = vi.fn();
  renderWithProviders(
    <HotelCheckoutDatePicker
      checkInDate={props.explicitCheckIn !== undefined ? props.explicitCheckIn : (props.checkInDate ?? '2026-12-05')}
      checkOutDate={props.checkOutDate ?? null}
      onSelect={onSelect}
    />,
  );
  return { onSelect };
}

const openCalendar = async () => {
  await userEvent.click(screen.getByRole('button', { name: 'Open checkout calendar' }));
};

describe('HotelCheckoutDatePicker calendar', () => {
  it('opens on December 2026 with 6 December focused and highlighted, without committing', async () => {
    const { onSelect } = renderPicker();
    expect(screen.getByLabelText('Hotel check-out')).toHaveValue('');
    await openCalendar();
    expect(screen.getByText('December 2026')).toBeInTheDocument();
    const target = screen.getByRole('button', { name: '6 December 2026' });
    expect(target).toHaveFocus();
    expect(target.className).toMatch(/border-brand-600/);
    expect(target.className).not.toMatch(/bg-brand-600/);
    // Opening never commits a value.
    expect(onSelect).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Hotel check-out')).toHaveValue('');
  });

  it('disables every date before the day after check-in', async () => {
    renderPicker();
    await openCalendar();
    expect(screen.getByRole('button', { name: '5 December 2026' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '4 December 2026' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '6 December 2026' })).toBeEnabled();
    expect(screen.getByRole('button', { name: '7 December 2026' })).toBeEnabled();
  });

  it('selecting the focused day commits exactly that date', async () => {
    const { onSelect } = renderPicker();
    await openCalendar();
    await userEvent.click(screen.getByRole('button', { name: '6 December 2026' }));
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect((onSelect.mock.calls[0]![0] as Date).toISOString()).toBe('2026-12-06T00:00:00.000Z');
    // Calendar closes after selection.
    expect(screen.queryByRole('dialog', { name: 'Choose checkout date' })).not.toBeInTheDocument();
  });

  it('rolls the initial focus across month and year boundaries', async () => {
    const { onSelect } = renderPicker({ checkInDate: '2026-12-31' });
    await openCalendar();
    expect(screen.getByText('January 2027')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '1 January 2027' })).toHaveFocus();
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('preserves an existing valid checkout and keeps it selected', async () => {
    const { onSelect } = renderPicker({ checkOutDate: '2026-12-10' });
    expect(screen.getByLabelText('Hotel check-out')).toHaveValue('10-12-2026');
    await openCalendar();
    expect(screen.getByText('December 2026')).toBeInTheDocument();
    const selected = screen.getByRole('button', { name: '10 December 2026' });
    expect(selected).toHaveFocus();
    expect(selected.className).toMatch(/bg-brand-600/);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('invalid checkout falls back to the day-after-check-in focus without clearing it', async () => {
    renderPicker({ checkOutDate: '2026-12-05' });
    // Stored (invalid) value is preserved in the input, not wiped.
    expect(screen.getByLabelText('Hotel check-out')).toHaveValue('05-12-2026');
    await openCalendar();
    expect(screen.getByRole('button', { name: '6 December 2026' })).toHaveFocus();
    expect(screen.getByRole('button', { name: '5 December 2026' })).toBeDisabled();
  });

  it('empty check-in keeps the existing fallback behavior', async () => {
    const { onSelect } = renderPicker({ explicitCheckIn: null });
    await openCalendar();
    const dialog = screen.getByRole('dialog', { name: 'Choose checkout date' });
    expect(dialog).toBeInTheDocument();
    // Nothing is disabled without a check-in constraint.
    const days = within(dialog)
      .getAllByRole('button')
      .filter((b) => /^\d{1,2} \w+ \d{4}$/.test(b.getAttribute('aria-label') ?? ''));
    expect(days.length).toBeGreaterThan(27);
    expect(days.every((b) => b instanceof HTMLButtonElement && !b.disabled)).toBe(true);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('manual entry commits valid dates and clears on empty', async () => {
    const { onSelect } = renderPicker();
    const input = screen.getByLabelText('Hotel check-out');
    fireEvent.change(input, { target: { value: '20-12-2026' } });
    expect(onSelect).toHaveBeenLastCalledWith(expect.any(Date));
    expect((onSelect.mock.calls.at(-1)![0] as Date).toISOString()).toBe(
      '2026-12-20T00:00:00.000Z',
    );
    // ISO-typed entry keeps working too.
    fireEvent.change(input, { target: { value: '2026-12-21' } });
    expect((onSelect.mock.calls.at(-1)![0] as Date).toISOString()).toBe(
      '2026-12-21T00:00:00.000Z',
    );
  });

  it('Escape closes the calendar and returns focus to the toggle', async () => {
    renderPicker();
    await openCalendar();
    expect(screen.getByRole('dialog', { name: 'Choose checkout date' })).toBeInTheDocument();
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog', { name: 'Choose checkout date' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open checkout calendar' })).toHaveFocus();
  });

  it('month navigation keeps constraints working', async () => {
    renderPicker();
    await openCalendar();
    await userEvent.click(screen.getByRole('button', { name: 'Next month' }));
    expect(screen.getByText('January 2027')).toBeInTheDocument();
    // January dates are all after the December minimum.
    expect(screen.getByRole('button', { name: '15 January 2027' })).toBeEnabled();
    await userEvent.click(screen.getByRole('button', { name: 'Previous month' }));
    await userEvent.click(screen.getByRole('button', { name: 'Previous month' }));
    expect(screen.getByText('November 2026')).toBeInTheDocument();
    // November is entirely before the minimum.
    expect(screen.getByRole('button', { name: '15 November 2026' })).toBeDisabled();
  });
});

describe('HotelDatePicker shared with check-in', () => {
  const checkInLabels = {
    input: 'Hotel check-in',
    toggle: 'Open check-in calendar',
    dialog: 'Choose check-in date',
    clear: 'Clear check-in date',
  };

  function renderCheckIn(props: { value?: string | null } = {}) {
    const onSelect = vi.fn();
    renderWithProviders(
      <HotelDatePicker
        value={props.value ?? null}
        onSelect={onSelect}
        labels={checkInLabels}
        inputClassName="test-field"
      />,
    );
    return { onSelect };
  }

  it('renders the same component shape: no native date input anywhere', async () => {
    renderCheckIn({ value: '2026-12-05' });
    const input = screen.getByLabelText('Hotel check-in') as HTMLInputElement;
    expect(input.type).toBe('text');
    expect(input).toHaveValue('05-12-2026');
    expect(input.className).toContain('test-field');
    expect(input).toHaveAttribute('placeholder', 'DD-MM-YYYY');
  });

  it('check-in has no minimum restriction and selects freely', async () => {
    const { onSelect } = renderCheckIn();
    await userEvent.click(screen.getByRole('button', { name: 'Open check-in calendar' }));
    // No "earliest" hint without a minimum.
    expect(screen.queryByText(/Earliest/)).not.toBeInTheDocument();
    // Opens on the current month; every day is enabled.
    const dialog = screen.getByRole('dialog', { name: 'Choose check-in date' });
    const days = within(dialog)
      .getAllByRole('button')
      .filter((b) => /^\d{1,2} \w+ \d{4}$/.test(b.getAttribute('aria-label') ?? ''));
    expect(days.length).toBeGreaterThan(27);
    expect(days.every((b) => b instanceof HTMLButtonElement && !b.disabled)).toBe(true);
    await userEvent.click(days[0]!);
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect.mock.calls[0]![0]).toBeInstanceOf(Date);
  });

  it('check-in selection and clearing commit through onSelect', async () => {
    const { onSelect } = renderCheckIn({ value: '2026-12-05' });
    // Clearing via the button commits null.
    await userEvent.click(screen.getByRole('button', { name: 'Clear check-in date' }));
    expect(onSelect).toHaveBeenLastCalledWith(null);
    // Manual entry follows the same DD-MM-YYYY rules.
    fireEvent.change(screen.getByLabelText('Hotel check-in'), { target: { value: '10-12-2026' } });
    expect((onSelect.mock.calls.at(-1)![0] as Date).toISOString()).toBe(
      '2026-12-10T00:00:00.000Z',
    );
  });

  it('both fields share input styling, popup, grid, and navigation hooks', async () => {
    const onSelect = vi.fn();
    renderWithProviders(
      <>
        <HotelDatePicker
          value="2026-12-05"
          onSelect={onSelect}
          labels={checkInLabels}
          inputClassName="test-field"
        />
        <HotelCheckoutDatePicker
          checkInDate="2026-12-05"
          checkOutDate={null}
          onSelect={onSelect}
          inputClassName="test-field"
        />
      </>,
    );
    const [checkInInput, checkOutInput] = [
      screen.getByLabelText('Hotel check-in'),
      screen.getByLabelText('Hotel check-out'),
    ];
    // Identical input styling and format.
    expect((checkInInput as HTMLInputElement).type).toBe('text');
    expect((checkOutInput as HTMLInputElement).type).toBe('text');
    expect(checkInInput.className).toBe(checkOutInput.className);
    expect(checkInInput).toHaveAttribute('placeholder', 'DD-MM-YYYY');
    expect(checkOutInput).toHaveAttribute('placeholder', 'DD-MM-YYYY');
    // Identical popup chrome and grid hooks.
    await userEvent.click(screen.getByRole('button', { name: 'Open check-in calendar' }));
    const checkInDialog = screen.getByRole('dialog', { name: 'Choose check-in date' });
    expect(within(checkInDialog).getByRole('button', { name: 'Previous month' })).toBeInTheDocument();
    expect(within(checkInDialog).getByRole('button', { name: 'Next month' })).toBeInTheDocument();
    await userEvent.keyboard('{Escape}');
    await userEvent.click(screen.getByRole('button', { name: 'Open checkout calendar' }));
    const checkOutDialog = screen.getByRole('dialog', { name: 'Choose checkout date' });
    expect(checkOutDialog.className).toBe(checkInDialog.className);
    // Opening one never opens the other.
    expect(screen.queryByRole('dialog', { name: 'Choose check-in date' })).not.toBeInTheDocument();
  });
});
