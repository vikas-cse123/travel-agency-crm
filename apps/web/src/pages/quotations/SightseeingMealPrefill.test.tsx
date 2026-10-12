import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useForm } from 'react-hook-form';
import { SightseeingSection, emptySightseeingDay } from './SightseeingSection';
import type { QuotationVersionInput } from '@interscale/shared';

const activityA = {
  id: 'safari-a',
  title: 'Night safari',
  sequence: 1,
  estimatedHours: 2.5,
  suggestedStartTime: '18:00',
  description: '<p>Night safari</p>',
  pricing: [],
  mealDefaults: {
    meals: { breakfast: true, lunch: false, dinner: true },
    mealModes: { breakfast: 'WITH_TRANSFER', lunch: null, dinner: 'INCLUDE_AT_HOTEL' },
    transfer: 'PRIVATE',
  },
  destination: { id: 'dest-1', name: 'Singapore' },
  city: { id: 'city-1', name: 'Singapore' },
  images: [],
};

const activityB = {
  id: 'safari-b',
  title: 'Morning walk',
  sequence: 2,
  estimatedHours: 1,
  suggestedStartTime: null,
  description: null,
  pricing: [],
  mealDefaults: {
    meals: { breakfast: false, lunch: true, dinner: false },
    mealModes: { lunch: 'NO_TRANSFER' },
    transfer: 'SHARED',
  },
  destination: { id: 'dest-1', name: 'Singapore' },
  city: { id: 'city-1', name: 'Singapore' },
  images: [],
};

const activityLegacy = {
  id: 'legacy-c',
  title: 'Old tour',
  sequence: 3,
  estimatedHours: null,
  suggestedStartTime: null,
  description: null,
  pricing: [],
  mealDefaults: null,
  destination: { id: 'dest-1', name: 'Singapore' },
  city: { id: 'city-1', name: 'Singapore' },
  images: [],
};

vi.mock('@/features/masters/masters.api', () => ({
  useSightseeingActivities: () => ({
    data: {
      activities: [activityA, activityB, activityLegacy],
      destination: { id: 'dest-1', name: 'Singapore' },
      city: { id: 'city-1', name: 'Singapore' },
    },
    isLoading: false,
    isError: false,
  }),
  useSightseeingPresentations: () => ({ data: {}, isLoading: false, isError: false }),
}));

function Harness({ days }: { days?: number } = {}) {
  const form = useForm<QuotationVersionInput>({
    defaultValues: {
      pricingMode: 'SECTION_WISE' as any,
      sightseeingDetails: {
        include: true,
        sectionTitle: 'Sightseeing',
        amount: 0,
        description: null,
        days: [emptySightseeingDay(1), ...(days === 2 ? [emptySightseeingDay(2)] : [])] as any,
      },
    } as any,
  });
  return (
    <SightseeingSection
      form={form}
      destination="Singapore"
      pax={{ adults: 2, childrenWithBed: 0, childrenWithoutBed: 0, infants: 0 }}
    />
  );
}

function dayArticle(dayIndex: number) {
  const title = screen.getByLabelText(`Sightseeing day ${dayIndex + 1} title`);
  const article = title.closest('article');
  if (!article) throw new Error(`day ${dayIndex + 1} article missing`);
  return article;
}

async function pickActivity(dayIndex: number, activityTitle: string) {
  const select = await screen.findByRole('combobox', { name: `Day ${dayIndex + 1} activity 1` });
  await userEvent.click(select);
  const listbox = await screen.findByRole('listbox');
  await userEvent.click(within(listbox).getByText(activityTitle));
}

/** Re-pick on an already-filled select: clear first so options are unfiltered. */
async function repickActivity(dayIndex: number, activityTitle: string) {
  const select = await screen.findByRole('combobox', { name: `Day ${dayIndex + 1} activity 1` });
  await userEvent.clear(select);
  await userEvent.type(select, activityTitle);
}

describe('Sightseeing master meal and transfer prefill', () => {
  it('populates day meals, meal modes, and transfer on selection', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true }) as Response);
    vi.stubGlobal('fetch', fetchMock);
    render(<Harness />);
    await pickActivity(0, 'Night safari');
    const day = dayArticle(0);

    await waitFor(() => expect(within(day).getByLabelText('breakfast')).toBeChecked());
    expect(within(day).getByLabelText('lunch')).not.toBeChecked();
    expect(within(day).getByLabelText('dinner')).toBeChecked();
    expect(
      within(within(day).getByRole('group', { name: 'breakfast meal options' })).getByLabelText(
        'With Transfer',
      ),
    ).toBeChecked();
    expect(
      within(within(day).getByRole('group', { name: 'dinner meal options' })).getByLabelText(
        'Include At Hotel',
      ),
    ).toBeChecked();
    expect(
      within(day).getByLabelText('Day 1 activity 1 daily transfer Private Transfer'),
    ).toBeChecked();
    // Selecting never writes back to the master API.
    const calls = fetchMock.mock.calls as unknown as Array<
      [unknown, { method?: string } | undefined]
    >;
    expect(
      calls.some(([url, options]) => {
        const method = options?.method ?? '';
        return String(url).includes('/masters/sightseeing') && ['POST', 'PATCH', 'PUT'].includes(method);
      }),
    ).toBe(false);
  });

  it('updates defaults when another activity is selected', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true }) as Response));
    render(<Harness />);
    await pickActivity(0, 'Night safari');
    const day = dayArticle(0);
    await waitFor(() => expect(within(day).getByLabelText('breakfast')).toBeChecked());

    await repickActivity(0, 'Morning walk');
    await waitFor(() => expect(within(day).getByLabelText('lunch')).toBeChecked());
    expect(within(day).getByLabelText('breakfast')).not.toBeChecked();
    expect(within(day).getByLabelText('dinner')).not.toBeChecked();
    expect(
      within(day).getByLabelText('Day 1 activity 1 daily transfer Shared Transfer'),
    ).toBeChecked();
  });

  it('keeps manual edits until the selection changes', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true }) as Response));
    render(<Harness />);
    await pickActivity(0, 'Night safari');
    const day = dayArticle(0);
    await waitFor(() => expect(within(day).getByLabelText('breakfast')).toBeChecked());

    // Manual edits stick: uncheck breakfast, switch transfer to shared.
    await userEvent.click(within(day).getByLabelText('breakfast'));
    await userEvent.click(within(day).getByLabelText('Day 1 activity 1 daily transfer Shared Transfer'));
    expect(within(day).getByLabelText('breakfast')).not.toBeChecked();
    expect(
      within(day).getByLabelText('Day 1 activity 1 daily transfer Shared Transfer'),
    ).toBeChecked();
  });

  it('applies defaults per day without leaking across days', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true }) as Response));
    render(<Harness days={2} />);
    // Manual edit on day 1 first: uncheck the default-on breakfast.
    const day1 = dayArticle(0);
    await userEvent.click(within(day1).getByLabelText('breakfast'));
    expect(within(day1).getByLabelText('breakfast')).not.toBeChecked();

    await userEvent.click(screen.getByRole('button', { name: 'Select sightseeing day 2' }));
    await pickActivity(1, 'Morning walk');
    const day2 = dayArticle(1);
    await waitFor(() => expect(within(day2).getByLabelText('lunch')).toBeChecked());
    expect(
      within(day2).getByLabelText('Day 2 activity 1 daily transfer Shared Transfer'),
    ).toBeChecked();

    // Day 1 keeps its manual edit and gains nothing from day 2's selection.
    // Re-select the tab so assertions read live form state, not a stale tree.
    await userEvent.click(screen.getByRole('button', { name: 'Select sightseeing day 1' }));
    const day1Again = dayArticle(0);
    expect(within(day1Again).getByLabelText('breakfast')).not.toBeChecked();
    expect(within(day1Again).getByLabelText('lunch')).not.toBeChecked();
    expect(within(day1Again).getByLabelText('dinner')).not.toBeChecked();
  });

  it('leaves entries untouched for masters without defaults', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true }) as Response));
    render(<Harness />);
    await pickActivity(0, 'Night safari');
    const day = dayArticle(0);
    await waitFor(() => expect(within(day).getByLabelText('dinner')).toBeChecked());

    // Switching to a master without defaults keeps the current values.
    await repickActivity(0, 'Old tour');
    expect(within(day).getByLabelText('breakfast')).toBeChecked();
    expect(within(day).getByLabelText('dinner')).toBeChecked();
    expect(
      within(day).getByLabelText('Day 1 activity 1 daily transfer Private Transfer'),
    ).toBeChecked();
  });
});
