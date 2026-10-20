import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useForm } from 'react-hook-form';
import { SightseeingSection, emptySightseeingDay } from './SightseeingSection';
import {
  buildSightseeingActivityTransfer,
  buildSightseeingDayMealPatch,
  resolveSightseeingMealPrefill,
} from '@/features/quotations/sightseeingMealPrefill';
import type { QuotationVersionInput } from '@interscale/shared';

// Night Safari master as described in the bug report: Breakfast included,
// breakfast arrangement Include At Hotel, overall transfer Shared Transfer.
const nightSafariMaster = {
  id: 'night-safari-id',
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

const lunchMaster = {
  id: 'lunch-id',
  title: 'City Lunch Tour',
  sequence: 2,
  estimatedHours: 3,
  suggestedStartTime: null,
  description: null,
  pricing: [],
  mealDefaults: {
    meals: { breakfast: false, lunch: true, dinner: true },
    mealModes: { lunch: 'WITH_TRANSFER', dinner: 'NO_TRANSFER' },
    mealTransferDetails: { lunch: 'Lobby pickup noon' },
    transfer: 'PRIVATE',
  },
  destination: { id: 'dest-1', name: 'Singapore' },
  city: { id: 'city-1', name: 'Singapore' },
  images: [],
};

const nullDefaultsMaster = {
  id: 'null-id',
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

vi.mock('@/features/masters/masters.api', () => ({
  useSightseeingActivities: () => ({
    data: {
      activities: [nightSafariMaster, lunchMaster, nullDefaultsMaster],
      destination: { id: 'dest-1', name: 'Singapore' },
      city: { id: 'city-1', name: 'Singapore' },
    },
    isLoading: false,
    isError: false,
  }),
  useSightseeingPresentations: () => ({ data: {}, isLoading: false, isError: false }),
}));

function Harness({ days }: { days?: any } = {}) {
  const form = useForm<QuotationVersionInput>({
    defaultValues: {
      pricingMode: 'SECTION_WISE' as any,
      sightseeingDetails: {
        include: true,
        sectionTitle: 'Sightseeing',
        amount: 0,
        description: null,
        days: (days ?? [emptySightseeingDay(1)]) as any,
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

/** Replicates QuotationBuilderPage's automatic day construction using the shared helper. */
function buildAutoDay(master: any, dayNumber = 1) {
  const baseDay = emptySightseeingDay(dayNumber);
  const mealPrefill = resolveSightseeingMealPrefill(master);
  const dayMeals = mealPrefill.meals ?? baseDay.meals;
  const dayMealPreferences: Record<string, any> = { ...(baseDay.mealPreferences as any) };
  if (mealPrefill.meals) {
    for (const meal of ['breakfast', 'lunch', 'dinner'] as const) {
      const mode = mealPrefill.mealModes[meal];
      const details = mealPrefill.mealTransferDetails[meal];
      if (mode) {
        dayMealPreferences[meal] = { mode, transferDetails: details ?? null };
      } else if (details) {
        const existing = dayMealPreferences[meal] ?? { mode: 'NO_TRANSFER', transferDetails: null };
        dayMealPreferences[meal] = { ...existing, transferDetails: details };
      } else if (mealPrefill.meals[meal] && !dayMealPreferences[meal]) {
        dayMealPreferences[meal] = { mode: 'NO_TRANSFER', transferDetails: null };
      }
    }
  }
  return emptySightseeingDay(dayNumber, {
    title: `Day ${dayNumber} - ${master.title}`,
    city: master.city?.name ?? null,
    date: null,
    meals: dayMeals,
    mealPreferences: dayMealPreferences as never,
    activities: [
      {
        sightseeingId: master.id,
        name: master.title,
        startTime: master.suggestedStartTime ?? null,
        showTime: Boolean(master.suggestedStartTime),
        duration: master.estimatedHours != null ? `${master.estimatedHours} hours` : null,
        city: master.city?.name ?? null,
        description: master.description ?? null,
        imageUrl: null,
        images: [],
        imageSnapshotPresent: false,
        pdfImageUrl: null,
        dailyTransfer: mealPrefill.activityTransfer ?? null,
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

async function pickActivity(dayIndex: number, activityTitle: string) {
  const select = await screen.findByRole('combobox', { name: `Day ${dayIndex + 1} activity 1` });
  await userEvent.click(select);
  const listbox = await screen.findByRole('listbox');
  await userEvent.click(within(listbox).getByText(activityTitle));
}

describe('sightseeing master prefill regression (Night Safari)', () => {
  it('helper resolves Night Safari to Breakfast + Include At Hotel + Shared', () => {
    const resolved = resolveSightseeingMealPrefill(nightSafariMaster as any);
    expect(resolved.meals).toEqual({ breakfast: true, lunch: false, dinner: false });
    expect(resolved.mealModes).toEqual({ breakfast: 'INCLUDE_AT_HOTEL' });
    expect(resolved.activityTransfer).toBe('SHARED');
    expect(buildSightseeingActivityTransfer(nightSafariMaster as any)).toBe('SHARED');
    const patch = buildSightseeingDayMealPatch(nightSafariMaster as any);
    expect(patch.meals).toEqual({ breakfast: true, lunch: false, dinner: false });
    expect(patch.mealPreferences?.breakfast?.mode).toBe('INCLUDE_AT_HOTEL');
  });

  it('automatically generated Night Safari day initializes correct values', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true }) as Response));
    const autoDay = buildAutoDay(nightSafariMaster);
    // Pure-object assertions (Path A data construction).
    expect(autoDay.meals).toEqual({ breakfast: true, lunch: false, dinner: false });
    expect((autoDay.mealPreferences as any)?.breakfast?.mode).toBe('INCLUDE_AT_HOTEL');
    expect((autoDay.activities[0] as any)?.dailyTransfer).toBe('SHARED');
    // Rendered through the actual builder component.
    render(<Harness days={[autoDay]} />);
    const day = dayArticle(0);
    await waitFor(() => expect(within(day).getByLabelText('breakfast')).toBeChecked());
    expect(within(day).getByLabelText('lunch')).not.toBeChecked();
    expect(within(day).getByLabelText('dinner')).not.toBeChecked();
    expect(
      within(within(day).getByRole('group', { name: 'breakfast meal options' })).getByLabelText(
        'Include At Hotel',
      ),
    ).toBeChecked();
    expect(
      within(day).getByLabelText('Day 1 activity 1 daily transfer Shared Transfer'),
    ).toBeChecked();
  });

  it('search-bar selection of Night Safari produces the same result', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true }) as Response));
    render(<Harness />);
    await pickActivity(0, 'Night Safari');
    const day = dayArticle(0);
    await waitFor(() => expect(within(day).getByLabelText('breakfast')).toBeChecked());
    expect(within(day).getByLabelText('lunch')).not.toBeChecked();
    expect(within(day).getByLabelText('dinner')).not.toBeChecked();
    expect(
      within(within(day).getByRole('group', { name: 'breakfast meal options' })).getByLabelText(
        'Include At Hotel',
      ),
    ).toBeChecked();
    expect(
      within(day).getByLabelText('Day 1 activity 1 daily transfer Shared Transfer'),
    ).toBeChecked();
  });

  it('other meal combinations and transfer values map correctly', () => {
    const resolved = resolveSightseeingMealPrefill(lunchMaster as any);
    expect(resolved.meals).toEqual({ breakfast: false, lunch: true, dinner: true });
    expect(resolved.mealModes).toEqual({ lunch: 'WITH_TRANSFER', dinner: 'NO_TRANSFER' });
    expect(resolved.mealTransferDetails).toEqual({ lunch: 'Lobby pickup noon' });
    expect(resolved.activityTransfer).toBe('PRIVATE');
  });

  it('unset master values use the intended fallback', () => {
    const resolved = resolveSightseeingMealPrefill(nullDefaultsMaster as any);
    expect(resolved.meals).toBeNull();
    expect(resolved.mealModes).toEqual({});
    expect(resolved.activityTransfer).toBeNull();
    // Bogus enums never write through.
    const bogus = resolveSightseeingMealPrefill({
      mealDefaults: {
        meals: { breakfast: true, lunch: false, dinner: false },
        mealModes: { breakfast: 'FLYING_CARPET' },
        transfer: 'HYPERLOOP',
      },
    } as any);
    expect(bogus.meals).toEqual({ breakfast: true, lunch: false, dinner: false });
    expect(bogus.mealModes).toEqual({});
    expect(bogus.activityTransfer).toBeNull();
  });

  it('existing user edits survive re-renders and tab changes', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true }) as Response));
    const autoDay = buildAutoDay(nightSafariMaster);
    const { rerender } = render(<Harness days={[autoDay, emptySightseeingDay(2)]} />);
    const day1 = dayArticle(0);
    await waitFor(() => expect(within(day1).getByLabelText('breakfast')).toBeChecked());
    // User unchecks breakfast and switches transfer to Private.
    await userEvent.click(within(day1).getByLabelText('breakfast'));
    await userEvent.click(
      within(day1).getByLabelText('Day 1 activity 1 daily transfer Private Transfer'),
    );
    expect(within(day1).getByLabelText('breakfast')).not.toBeChecked();
    // Switch to day 2 tab and back — edits must survive.
    await userEvent.click(screen.getByRole('button', { name: 'Select sightseeing day 2' }));
    await userEvent.click(screen.getByRole('button', { name: 'Select sightseeing day 1' }));
    const day1Again = dayArticle(0);
    expect(within(day1Again).getByLabelText('breakfast')).not.toBeChecked();
    expect(
      within(day1Again).getByLabelText('Day 1 activity 1 daily transfer Private Transfer'),
    ).toBeChecked();
    // Re-render must not reset edits either.
    rerender(<Harness days={[autoDay, emptySightseeingDay(2)]} />);
  });

  it('editing an existing quotation preserves its saved selections', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true }) as Response));
    const savedDay = emptySightseeingDay(1, {
      title: 'Day 1 - Night Safari',
      city: 'Singapore',
      meals: { breakfast: true, lunch: true, dinner: false },
      mealPreferences: {
        breakfast: { mode: 'WITH_TRANSFER', transferDetails: '7 AM pickup' },
        lunch: { mode: 'INCLUDE_AT_HOTEL', transferDetails: null },
      } as never,
      activities: [
        {
          sightseeingId: 'night-safari-id',
          name: 'Night Safari',
          startTime: '18:00',
          showTime: true,
          duration: '2.5 hours',
          city: 'Singapore',
          description: '<p>Night Safari</p>',
          imageUrl: null,
          images: [],
          imageSnapshotPresent: false,
          pdfImageUrl: null,
          dailyTransfer: 'SHARED',
          pricingOptions: [],
          pricingBasis: null,
          pricingQuantity: null,
          sequence: 1,
          displayPricing: [],
          displayPricingHeading: 'PRICING',
        } as never,
      ],
    });
    render(<Harness days={[savedDay]} />);
    const day = dayArticle(0);
    await waitFor(() => expect(within(day).getByLabelText('breakfast')).toBeChecked());
    expect(within(day).getByLabelText('lunch')).toBeChecked();
    expect(
      within(within(day).getByRole('group', { name: 'breakfast meal options' })).getByLabelText(
        'With Transfer',
      ),
    ).toBeChecked();
    expect(within(day).getByLabelText('breakfast transfer details')).toHaveValue('7 AM pickup');
    expect(
      within(day).getByLabelText('Day 1 activity 1 daily transfer Shared Transfer'),
    ).toBeChecked();
  });
});
