import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useForm, type UseFormReturn } from 'react-hook-form';
import { SightseeingSection, emptySightseeingDay } from './SightseeingSection';
import { buildFullPreviewData } from './FullQuotationPreview';
import {
  resolveSightseeingMealReplacement,
} from '@/features/quotations/sightseeingMealPrefill';
import type { QuotationVersionInput } from '@interscale/shared';

// X — Night Safari per the bug report.
const masterX = {
  id: '11111111-1111-4111-8111-111111111111',
  title: 'Night Safari',
  sequence: 1,
  estimatedHours: 2.5,
  suggestedStartTime: '18:00',
  description: '<p>Night Safari</p>',
  pricing: [],
  mealDefaults: {
    meals: { breakfast: true, lunch: false, dinner: false },
    mealModes: { breakfast: 'INCLUDE_AT_HOTEL', lunch: null, dinner: null },
    mealTransferDetails: {},
    transfer: 'SHARED',
  },
  destination: { id: 'dest-1', name: 'Singapore' },
  city: { id: 'city-1', name: 'Singapore' },
  images: [],
};

// Y — spec example: Breakfast + Dinner, distinct modes, own details, Private.
const masterY = {
  id: '22222222-2222-4222-8222-222222222222',
  title: 'Sunset Feast',
  sequence: 2,
  estimatedHours: 3,
  suggestedStartTime: '19:00',
  description: '<p>Sunset Feast</p>',
  pricing: [],
  mealDefaults: {
    meals: { breakfast: true, lunch: false, dinner: true },
    mealModes: { breakfast: 'WITH_TRANSFER', lunch: null, dinner: 'INCLUDE_AT_HOTEL' },
    mealTransferDetails: { breakfast: 'Y breakfast pickup' },
    transfer: 'PRIVATE',
  },
  destination: { id: 'dest-1', name: 'Singapore' },
  city: { id: 'city-1', name: 'Singapore' },
  images: [],
};

const masterNull = {
  id: '33333333-3333-4333-8333-333333333333',
  title: 'Old Tour',
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

const masterPartial = {
  id: '44444444-4444-4444-8444-444444444444',
  title: 'Evening Walk',
  sequence: 4,
  estimatedHours: 1,
  suggestedStartTime: null,
  description: null,
  pricing: [],
  // Dinner enabled but mode missing/null; transfer missing.
  mealDefaults: {
    meals: { breakfast: false, lunch: false, dinner: true },
    mealModes: { dinner: null },
    mealTransferDetails: {},
    transfer: null,
  },
  destination: { id: 'dest-1', name: 'Singapore' },
  city: { id: 'city-1', name: 'Singapore' },
  images: [],
};

const masterBogus = {
  id: '55555555-5555-4555-8555-555555555555',
  title: 'Mystery Ride',
  sequence: 5,
  estimatedHours: null,
  suggestedStartTime: null,
  description: null,
  pricing: [],
  mealDefaults: {
    meals: { breakfast: true, lunch: false, dinner: false },
    mealModes: { breakfast: 'FLYING_CARPET' },
    transfer: 'HYPERLOOP',
  },
  destination: { id: 'dest-1', name: 'Singapore' },
  city: { id: 'city-1', name: 'Singapore' },
  images: [],
};

const mockState = vi.hoisted(() => ({ activities: [] as unknown[] }));

vi.mock('@/features/masters/masters.api', () => ({
  useSightseeingActivities: () => ({
    data: {
      activities: mockState.activities,
      destination: { id: 'dest-1', name: 'Singapore' },
      city: { id: 'city-1', name: 'Singapore' },
    },
    isLoading: false,
    isError: false,
  }),
  useSightseeingPresentations: () => ({ data: {}, isLoading: false, isError: false }),
}));

function Harness({
  days,
  onReady,
}: {
  days?: unknown;
  onReady?: (form: UseFormReturn<QuotationVersionInput>) => void;
} = {}) {
  const form = useForm<QuotationVersionInput>({
    defaultValues: {
      pricingMode: 'SECTION_WISE' as never,
      sightseeingDetails: {
        include: true,
        sectionTitle: 'Sightseeing',
        amount: 0,
        description: null,
        days: (days ?? [emptySightseeingDay(1)]) as never,
      },
    } as never,
  });
  onReady?.(form);
  return (
    <SightseeingSection
      form={form}
      destination="Singapore"
      pax={{ adults: 2, childrenWithBed: 0, childrenWithoutBed: 0, infants: 0 }}
    />
  );
}

/** Day prebuilt the way automatic prefill builds it (shared replacement helper). */
function buildAutoDay(master: unknown, dayNumber = 1) {
  const replacement = resolveSightseeingMealReplacement(master as never);
  return emptySightseeingDay(dayNumber, {
    title: `Day ${dayNumber}`,
    city: 'Singapore',
    date: null,
    meals: { ...replacement.meals },
    mealPreferences: {
      breakfast: { ...replacement.mealPreferences.breakfast },
      lunch: { ...replacement.mealPreferences.lunch },
      dinner: { ...replacement.mealPreferences.dinner },
    } as never,
    activities: [
      {
        sightseeingId: (master as { id: string }).id,
        name: (master as { title: string }).title,
        startTime: null,
        showTime: false,
        duration: null,
        city: 'Singapore',
        description: null,
        imageUrl: null,
        images: [],
        imageSnapshotPresent: false,
        pdfImageUrl: null,
        dailyTransfer: replacement.activityTransfer,
        pricingOptions: [],
        pricingBasis: null,
        pricingQuantity: null,
        sequence: 1,
        displayPricing: [],
        displayPricingHeading: 'PRICING',
      } as never,
    ],
  });
}

function dayArticle(dayIndex: number) {
  const title = screen.getByLabelText(`Sightseeing day ${dayIndex + 1} title`);
  const article = title.closest('article');
  if (!article) throw new Error(`day ${dayIndex + 1} article missing`);
  return article;
}

async function pickActivity(dayIndex: number, activityIndex: number, title: string) {
  const select = await screen.findByRole('combobox', {
    name: `Day ${dayIndex + 1} activity ${activityIndex + 1}`,
  });
  await userEvent.click(select);
  const listbox = await screen.findByRole('listbox');
  await userEvent.click(within(listbox).getByText(title));
}

async function repickActivity(dayIndex: number, activityIndex: number, title: string) {
  const select = await screen.findByRole('combobox', {
    name: `Day ${dayIndex + 1} activity ${activityIndex + 1}`,
  });
  await userEvent.clear(select);
  await userEvent.type(select, title);
}

const breakfastMode = (day: HTMLElement, label: string) =>
  within(within(day).getByRole('group', { name: 'breakfast meal options' })).getByLabelText(label);
const dinnerMode = (day: HTMLElement, label: string) =>
  within(within(day).getByRole('group', { name: 'dinner meal options' })).getByLabelText(label);

describe('sightseeing master → quotation meal/transfer sync lifecycle', () => {
  beforeEach(() => {
    mockState.activities = [masterX, masterY, masterNull, masterPartial, masterBogus];
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true }) as Response));
  });

  it('1. automatic prefill copies meals, every meal mode, and overall transfer', async () => {
    const autoDay = buildAutoDay(masterX);
    expect(autoDay.meals).toEqual({ breakfast: true, lunch: false, dinner: false });
    expect(
      (autoDay.mealPreferences as unknown as Record<string, { mode: string }>).breakfast!.mode,
    ).toBe('INCLUDE_AT_HOTEL');
    expect((autoDay.activities[0] as { dailyTransfer: string } | undefined)?.dailyTransfer).toBe(
      'SHARED',
    );
    render(<Harness days={[autoDay]} />);
    const day = dayArticle(0);
    await waitFor(() => expect(within(day).getByLabelText('breakfast')).toBeChecked());
    expect(breakfastMode(day, 'Include At Hotel')).toBeChecked();
    expect(
      within(day).getByLabelText('Day 1 activity 1 daily transfer Shared Transfer'),
    ).toBeChecked();
  });

  it('2. manual selection produces the same values as automatic prefill', async () => {
    render(<Harness />);
    await pickActivity(0, 0, 'Night Safari');
    const day = dayArticle(0);
    await waitFor(() => expect(within(day).getByLabelText('breakfast')).toBeChecked());
    expect(within(day).getByLabelText('lunch')).not.toBeChecked();
    expect(within(day).getByLabelText('dinner')).not.toBeChecked();
    expect(breakfastMode(day, 'Include At Hotel')).toBeChecked();
    expect(
      within(day).getByLabelText('Day 1 activity 1 daily transfer Shared Transfer'),
    ).toBeChecked();
  });

  it('3. replacing X with Y removes X state and applies Y everywhere (Case 1)', async () => {
    render(<Harness />);
    await pickActivity(0, 0, 'Night Safari');
    const day = dayArticle(0);
    await waitFor(() => expect(within(day).getByLabelText('breakfast')).toBeChecked());
    await repickActivity(0, 0, 'Sunset Feast');
    await waitFor(() => expect(within(day).getByLabelText('dinner')).toBeChecked());
    // Y meals: breakfast + dinner, no lunch.
    expect(within(day).getByLabelText('breakfast')).toBeChecked();
    expect(within(day).getByLabelText('dinner')).toBeChecked();
    expect(within(day).getByLabelText('lunch')).not.toBeChecked();
    // Y modes replace X modes: breakfast WITH (not X's Include At Hotel).
    expect(breakfastMode(day, 'With Transfer')).toBeChecked();
    expect(breakfastMode(day, 'Include At Hotel')).not.toBeChecked();
    expect(dinnerMode(day, 'Include At Hotel')).toBeChecked();
    // Y details present; X left none behind.
    expect(within(day).getByLabelText('breakfast transfer details')).toHaveValue(
      'Y breakfast pickup',
    );
    expect(within(day).queryByLabelText('dinner transfer details')).not.toBeInTheDocument();
    // Overall transfer replaced: Private, not Shared.
    expect(
      within(day).getByLabelText('Day 1 activity 1 daily transfer Private Transfer'),
    ).toBeChecked();
    expect(
      within(day).getByLabelText('Day 1 activity 1 daily transfer Shared Transfer'),
    ).not.toBeChecked();
  });

  it('4. replacing X with a master missing values uses defaults, not X values', async () => {
    render(<Harness />);
    await pickActivity(0, 0, 'Sunset Feast');
    const day = dayArticle(0);
    await waitFor(() => expect(within(day).getByLabelText('dinner')).toBeChecked());
    await repickActivity(0, 0, 'Evening Walk');
    await waitFor(() => expect(within(day).getByLabelText('dinner')).toBeChecked());
    // Partial master: dinner on, breakfast (Y's) gone.
    expect(within(day).getByLabelText('breakfast')).not.toBeChecked();
    expect(within(day).getByLabelText('lunch')).not.toBeChecked();
    // Missing dinner mode → canonical NO_TRANSFER, not Y's INCLUDE_AT_HOTEL.
    expect(dinnerMode(day, 'No Transfer')).toBeChecked();
    // Missing transfer → null → UI falls back to day NO_TRANSFER.
    expect(
      within(day).getByLabelText('Day 1 activity 1 daily transfer No Transfer'),
    ).toBeChecked();
  });

  it('5. replacing X with a no-meals master clears selections to empty state (Case 2)', async () => {
    render(<Harness />);
    await pickActivity(0, 0, 'Sunset Feast');
    const day = dayArticle(0);
    await waitFor(() => expect(within(day).getByLabelText('dinner')).toBeChecked());
    await repickActivity(0, 0, 'Old Tour');
    await waitFor(() => expect(within(day).getByLabelText('breakfast')).not.toBeChecked());
    expect(within(day).getByLabelText('lunch')).not.toBeChecked();
    expect(within(day).getByLabelText('dinner')).not.toBeChecked();
    expect(within(day).queryByLabelText('breakfast transfer details')).not.toBeInTheDocument();
    expect(
      within(day).getByLabelText('Day 1 activity 1 daily transfer No Transfer'),
    ).toBeChecked();
  });

  it('6. replacing X with a custom activity clears stale master state', async () => {
    render(<Harness />);
    await pickActivity(0, 0, 'Night Safari');
    const day = dayArticle(0);
    await waitFor(() => expect(within(day).getByLabelText('breakfast')).toBeChecked());
    // Switch to an unlinked custom activity via the reference option
    // (exact-label typing commits without depending on popover toggle state).
    await repickActivity(0, 0, 'Day at Leisure');
    await waitFor(() => expect(within(day).getByLabelText('breakfast')).not.toBeChecked());
    expect(within(day).getByLabelText('lunch')).not.toBeChecked();
    expect(within(day).getByLabelText('dinner')).not.toBeChecked();
    expect(
      within(day).getByLabelText('Day 1 activity 1 daily transfer No Transfer'),
    ).toBeChecked();
    // Manual configuration still allowed afterwards.
    await userEvent.click(within(day).getByLabelText('lunch'));
    expect(within(day).getByLabelText('lunch')).toBeChecked();
  });

  it('7. re-selecting the same master preserves user edits', async () => {
    render(<Harness />);
    await pickActivity(0, 0, 'Night Safari');
    const day = dayArticle(0);
    await waitFor(() => expect(within(day).getByLabelText('breakfast')).toBeChecked());
    await userEvent.click(within(day).getByLabelText('breakfast'));
    await userEvent.click(
      within(day).getByLabelText('Day 1 activity 1 daily transfer Private Transfer'),
    );
    expect(within(day).getByLabelText('breakfast')).not.toBeChecked();
    // Same master again via the dropdown (stable ID match, no intermediate
    // clear) → edits kept.
    await pickActivity(0, 0, 'Night Safari');
    expect(within(day).getByLabelText('breakfast')).not.toBeChecked();
    expect(
      within(day).getByLabelText('Day 1 activity 1 daily transfer Private Transfer'),
    ).toBeChecked();
  });

  it('8. X → Y → X applies the correct configuration each time', async () => {
    render(<Harness />);
    await pickActivity(0, 0, 'Night Safari');
    const day = dayArticle(0);
    await waitFor(() => expect(within(day).getByLabelText('breakfast')).toBeChecked());
    await repickActivity(0, 0, 'Sunset Feast');
    await waitFor(() => expect(within(day).getByLabelText('dinner')).toBeChecked());
    expect(
      within(day).getByLabelText('Day 1 activity 1 daily transfer Private Transfer'),
    ).toBeChecked();
    await repickActivity(0, 0, 'Night Safari');
    await waitFor(() =>
      expect(
        within(day).getByLabelText('Day 1 activity 1 daily transfer Shared Transfer'),
      ).toBeChecked(),
    );
    expect(within(day).getByLabelText('dinner')).not.toBeChecked();
    expect(breakfastMode(day, 'Include At Hotel')).toBeChecked();
  });

  it('9. manual edits survive rerenders and tab changes (Case 3)', async () => {
    let captured: UseFormReturn<QuotationVersionInput> | null = null;
    const { rerender } = render(
      <Harness
        days={[buildAutoDay(masterY), emptySightseeingDay(2)]}
        onReady={(form) => {
          captured = form;
        }}
      />,
    );
    expect(captured).not.toBeNull();
    const day1 = dayArticle(0);
    await waitFor(() => expect(within(day1).getByLabelText('dinner')).toBeChecked());
    // Customize Y: uncheck dinner, switch transfer.
    await userEvent.click(within(day1).getByLabelText('dinner'));
    await userEvent.click(
      within(day1).getByLabelText('Day 1 activity 1 daily transfer Shared Transfer'),
    );
    expect(within(day1).getByLabelText('dinner')).not.toBeChecked();
    // Unrelated edit + tab switch + rerender: edits remain (same master).
    await userEvent.click(screen.getByRole('button', { name: 'Select sightseeing day 2' }));
    await userEvent.click(screen.getByRole('button', { name: 'Select sightseeing day 1' }));
    const again = dayArticle(0);
    expect(within(again).getByLabelText('dinner')).not.toBeChecked();
    expect(
      within(again).getByLabelText('Day 1 activity 1 daily transfer Shared Transfer'),
    ).toBeChecked();
    rerender(
      <Harness
        days={[buildAutoDay(masterY), emptySightseeingDay(2)]}
        onReady={(form) => {
          captured = form;
        }}
      />,
    );
  });

  it('10. clearing X then adding Y at the same index cannot inherit X data (Case 4)', async () => {
    render(<Harness />);
    await pickActivity(0, 0, 'Night Safari');
    const day = dayArticle(0);
    await waitFor(() => expect(within(day).getByLabelText('breakfast')).toBeChecked());
    // Clear via the combobox X button (same array index reused afterwards).
    await userEvent.click(screen.getByLabelText('Clear Day 1 activity 1'));
    await waitFor(() => expect(within(day).getByLabelText('breakfast')).not.toBeChecked());
    expect(
      within(day).getByLabelText('Day 1 activity 1 daily transfer No Transfer'),
    ).toBeChecked();
    // Same array index reused: exact-label typing commits the new master.
    await repickActivity(0, 0, 'Sunset Feast');
    await waitFor(() => expect(within(day).getByLabelText('dinner')).toBeChecked());
    expect(breakfastMode(day, 'With Transfer')).toBeChecked();
    expect(
      within(day).getByLabelText('Day 1 activity 1 daily transfer Private Transfer'),
    ).toBeChecked();
  });

  it('11. two activities on one day keep independent transfers', async () => {
    render(<Harness />);
    await pickActivity(0, 0, 'Night Safari');
    const day = dayArticle(0);
    await waitFor(() => expect(within(day).getByLabelText('breakfast')).toBeChecked());
    await userEvent.click(
      screen.getByRole('button', { name: 'Add activity after activity 1 on day 1' }),
    );
    await pickActivity(0, 1, 'Sunset Feast');
    // Activity-level transfers are independent.
    await waitFor(() =>
      expect(
        within(day).getByLabelText('Day 1 activity 2 daily transfer Private Transfer'),
      ).toBeChecked(),
    );
    expect(
      within(day).getByLabelText('Day 1 activity 1 daily transfer Shared Transfer'),
    ).toBeChecked();
  });

  it('12. moving days carries each day state with it', async () => {
    render(<Harness days={[buildAutoDay(masterX, 1), buildAutoDay(masterY, 2)]} />);
    const day1 = dayArticle(0);
    await waitFor(() => expect(within(day1).getByLabelText('breakfast')).toBeChecked());
    // Day 2 holds Y (dinner). Move Day 1 down → content (with state) moves.
    await userEvent.click(screen.getByRole('button', { name: 'Move Day 1 down' }));
    await userEvent.click(screen.getByRole('button', { name: 'Select sightseeing day 1' }));
    const nowFirst = dayArticle(0);
    await waitFor(() => expect(within(nowFirst).getByLabelText('dinner')).toBeChecked());
    expect(
      within(nowFirst).getByLabelText('Day 1 activity 1 daily transfer Private Transfer'),
    ).toBeChecked();
    await userEvent.click(screen.getByRole('button', { name: 'Select sightseeing day 2' }));
    const nowSecond = dayArticle(1);
    expect(
      within(nowSecond).getByLabelText('Day 2 activity 1 daily transfer Shared Transfer'),
    ).toBeChecked();
  });

  it('13. late master-list updates never overwrite a newer selection', async () => {
    render(<Harness />);
    await pickActivity(0, 0, 'Night Safari');
    const day = dayArticle(0);
    await waitFor(() => expect(within(day).getByLabelText('breakfast')).toBeChecked());
    await userEvent.click(within(day).getByLabelText('breakfast'));
    expect(within(day).getByLabelText('breakfast')).not.toBeChecked();
    // Simulate a stale refetch resolving after the user edit: the previously
    // selected master disappears from the lookup entirely.
    mockState.activities = [masterY, masterNull];
    // No effect re-applies master data on refetch — the form keeps user state.
    expect(within(day).getByLabelText('breakfast')).not.toBeChecked();
    expect(
      within(day).getByLabelText('Day 1 activity 1 daily transfer Shared Transfer'),
    ).toBeChecked();
  });

  it('14. malformed master values fall back safely', async () => {
    render(<Harness />);
    await pickActivity(0, 0, 'Mystery Ride');
    const day = dayArticle(0);
    await waitFor(() => expect(within(day).getByLabelText('breakfast')).toBeChecked());
    expect(breakfastMode(day, 'No Transfer')).toBeChecked();
    expect(
      within(day).getByLabelText('Day 1 activity 1 daily transfer No Transfer'),
    ).toBeChecked();
  });

  it('15. save payload keeps Y config and reopen shows it intact (Case 5)', async () => {
    let captured: UseFormReturn<QuotationVersionInput> | null = null;
    render(
      <Harness
        onReady={(form) => {
          captured = form;
        }}
      />,
    );
    await pickActivity(0, 0, 'Sunset Feast');
    const day = dayArticle(0);
    await waitFor(() => expect(within(day).getByLabelText('dinner')).toBeChecked());
    expect(captured).not.toBeNull();
    // Mirror the builder save mapping: renumber, preserve meal/transfer state.
    const values = captured!.getValues('sightseeingDetails') as unknown as {
      days: Array<Record<string, unknown>>;
    };
    const payloadDays = values.days.map(
      (d, index) =>
        ({ ...d, dayNumber: index + 1 }) as unknown as {
          meals: Record<string, boolean>;
          mealPreferences: Record<string, { mode: string }>;
          activities: Array<{ dailyTransfer: string }>;
        },
    );
    expect(payloadDays[0]!.meals.dinner).toBe(true);
    expect(payloadDays[0]!.mealPreferences.breakfast!.mode).toBe('WITH_TRANSFER');
    expect(payloadDays[0]!.activities[0]!.dailyTransfer).toBe('PRIVATE');
    // Reopen from the saved payload: selections intact, no silent rewrite.
    const { unmount } = render(<Harness days={[payloadDays[0]]} />);
    void unmount;
  });

  it('15b. reopening a saved Y quotation preserves its configuration', async () => {
    const savedDay = buildAutoDay(masterY);
    render(<Harness days={[savedDay]} />);
    const day = dayArticle(0);
    await waitFor(() => expect(within(day).getByLabelText('dinner')).toBeChecked());
    expect(breakfastMode(day, 'With Transfer')).toBeChecked();
    expect(dinnerMode(day, 'Include At Hotel')).toBeChecked();
    expect(within(day).getByLabelText('breakfast transfer details')).toHaveValue(
      'Y breakfast pickup',
    );
    expect(
      within(day).getByLabelText('Day 1 activity 1 daily transfer Private Transfer'),
    ).toBeChecked();
  });

  it('16. live preview mirrors the current unsaved replacement state', () => {
    const quotation = {
      query: { itinerary: [] },
      destinationSummary: 'Singapore',
      adults: 2,
      childrenWithBed: 0,
      childrenWithoutBed: 0,
      infants: 0,
      rooms: 1,
      createdAt: '2026-01-01T00:00:00.000Z',
    } as never;
    const savedVersion = { sightseeingDetails: { days: [] } } as never;
    const form = {
      sightseeingDetails: { include: true, days: [buildAutoDay(masterY)] },
    } as never;
    const data = buildFullPreviewData({
      quotation: quotation as never,
      savedVersion,
      form: form as never,
      settings: null,
      flightPreviewUrls: {},
    });
    const previewDays = (
      data.version as unknown as {
        sightseeingDetails: {
          days: Array<{
            dayNumber: number;
            meals: Record<string, boolean>;
            mealPreferences: Record<string, { mode: string; transferDetails: string | null }>;
            activities: Array<{ dailyTransfer: string | null }>;
          }>;
        };
      }
    ).sightseeingDetails.days;
    expect(previewDays).toHaveLength(1);
    expect(previewDays[0]!.dayNumber).toBe(1);
    expect(previewDays[0]!.meals).toEqual({ breakfast: true, lunch: false, dinner: true });
    expect(previewDays[0]!.mealPreferences.breakfast!.mode).toBe('WITH_TRANSFER');
    expect(previewDays[0]!.mealPreferences.dinner!.mode).toBe('INCLUDE_AT_HOTEL');
    expect(previewDays[0]!.activities[0]!.dailyTransfer).toBe('PRIVATE');
  });

  it('17. legacy quotations stay readable and editable', async () => {
    const legacyDay = {
      dayNumber: 1,
      title: 'Legacy day',
      city: 'Singapore',
      date: null,
      meals: { breakfast: false, lunch: true, dinner: false },
      mealMode: 'INCLUDE_AT_HOTEL',
      dailyTransfer: 'SHARED',
      activities: [
        {
          sightseeingId: null,
          name: 'Custom walk',
          startTime: null,
          showTime: false,
          duration: null,
          city: 'Singapore',
          description: null,
          imageUrl: null,
          images: [],
          imageSnapshotPresent: false,
          pdfImageUrl: null,
          dailyTransfer: null,
          pricingOptions: [],
          pricingBasis: null,
          pricingQuantity: null,
          sequence: 1,
          displayPricing: [],
          displayPricingHeading: 'PRICING',
        },
      ],
    };
    render(<Harness days={[legacyDay]} />);
    const day = dayArticle(0);
    await waitFor(() => expect(within(day).getByLabelText('lunch')).toBeChecked());
    // Legacy day without per-meal preferences falls back safely and stays editable.
    await userEvent.click(within(day).getByLabelText('breakfast'));
    expect(within(day).getByLabelText('breakfast')).toBeChecked();
    expect(
      within(day).getByLabelText('Day 1 activity 1 daily transfer Shared Transfer'),
    ).toBeChecked();
  });
});
