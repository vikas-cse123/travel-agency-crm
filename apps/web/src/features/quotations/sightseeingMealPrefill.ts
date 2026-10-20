import {
  SIGHTSEEING_MEAL_MODES,
  SIGHTSEEING_TRANSFER_MODES,
} from '@interscale/shared';

export const SIGHTSEEING_MEAL_KEYS = ['breakfast', 'lunch', 'dinner'] as const;
export type SightseeingMealKey = (typeof SIGHTSEEING_MEAL_KEYS)[number];
export type SightseeingMealMode = (typeof SIGHTSEEING_MEAL_MODES)[number];
export type SightseeingOverallTransfer = (typeof SIGHTSEEING_TRANSFER_MODES)[number];

/** Loose master shape — mirrors `mealDefaults` on Sightseeing/SightseeingActivity. */
export interface SightseeingMealDefaultsLike {
  meals?:
    | { breakfast?: boolean | null | undefined; lunch?: boolean | null | undefined; dinner?: boolean | null | undefined }
    | null
    | undefined;
  mealModes?:
    | {
        breakfast?: string | null | undefined;
        lunch?: string | null | undefined;
        dinner?: string | null | undefined;
      }
    | null
    | undefined;
  mealTransferDetails?:
    | {
        breakfast?: string | null | undefined;
        lunch?: string | null | undefined;
        dinner?: string | null | undefined;
      }
    | null
    | undefined;
  transfer?: string | null | undefined;
}

export interface SightseeingMasterLike {
  mealDefaults?: SightseeingMealDefaultsLike | null | undefined;
}

const MEAL_MODE_SET = new Set<string>(SIGHTSEEING_MEAL_MODES as readonly string[]);
const TRANSFER_SET = new Set<string>(SIGHTSEEING_TRANSFER_MODES as readonly string[]);

export function isSightseeingMealMode(value: unknown): value is SightseeingMealMode {
  return typeof value === 'string' && MEAL_MODE_SET.has(value);
}

export function isSightseeingOverallTransfer(
  value: unknown,
): value is SightseeingOverallTransfer {
  return typeof value === 'string' && TRANSFER_SET.has(value);
}

export interface ResolvedSightseeingMealPrefill {
  /** Day-level `meals` checkboxes. Null when the master carries no defaults. */
  meals: Record<SightseeingMealKey, boolean> | null;
  /** Valid per-meal modes, only for enabled meals. */
  mealModes: Partial<Record<SightseeingMealKey, SightseeingMealMode>>;
  /** Non-empty per-meal transfer details, only for enabled meals. */
  mealTransferDetails: Partial<Record<SightseeingMealKey, string>>;
  /** Valid overall transfer for the activity, or null to keep the fallback. */
  activityTransfer: SightseeingOverallTransfer | null;
}

/**
 * Canonical empty state applied when a master configures nothing (or when an
 * activity becomes custom/unlinked). Derived from the existing data model:
 * schema defaults are all-false meals with `NO_TRANSFER` modes and null
 * details; the activity transfer is null so the UI falls back to the day's
 * `NO_TRANSFER`. This is the "empty state" referenced by the replacement
 * rules — never inherited from a previous attraction.
 */
export const EMPTY_SIGHTSEEING_MEALS: Record<SightseeingMealKey, boolean> = {
  breakfast: false,
  lunch: false,
  dinner: false,
};

export interface FullSightseeingMealReplacement {
  /** Complete day-level meals — always all three keys, never partial. */
  meals: Record<SightseeingMealKey, boolean>;
  /** Complete per-meal preferences — all three keys with canonical defaults. */
  mealPreferences: Record<
    SightseeingMealKey,
    { mode: SightseeingMealMode; transferDetails: string | null }
  >;
  /** Activity overall transfer — valid enum or null (falls back to day NO_TRANSFER). */
  activityTransfer: SightseeingOverallTransfer | null;
  /** True when the master actually carried a `mealDefaults` object. */
  hasMasterDefaults: boolean;
}

/**
 * Single source of truth mapping a sightseeing master's `mealDefaults` onto
 * quotation-builder fields. Both the automatically generated day prefill
 * (QuotationBuilderPage) and the manual search-bar selection
 * (SightseeingSection `pickMaster`) must use this so they cannot drift apart.
 *
 * Rules (mirroring the long-standing manual-selection behavior):
 * - `mealDefaults` null/undefined → return nulls so callers keep existing
 *   values (the `emptySightseeingDay` fallback for fresh days).
 * - `meals` booleans are copied verbatim (missing → false).
 * - `mealModes` copy over only when the meal is enabled AND the value is a
 *   known `SIGHTSEEING_MEAL_MODES` enum; malformed values are ignored so the
 *   caller keeps its current mode (fresh days fall back to NO_TRANSFER).
 * - `mealTransferDetails` copy over only when the meal is enabled AND the
 *   text is non-blank; otherwise manual details are kept.
 * - `transfer` copies over only when it is a known
 *   `SIGHTSEEING_TRANSFER_MODES` value; otherwise the fallback is kept.
 */
export function resolveSightseeingMealPrefill(
  master: SightseeingMasterLike | null | undefined,
): ResolvedSightseeingMealPrefill {
  const mealDefaults = master?.mealDefaults;
  if (!mealDefaults) {
    return { meals: null, mealModes: {}, mealTransferDetails: {}, activityTransfer: null };
  }
  const meals: Record<SightseeingMealKey, boolean> = {
    breakfast: Boolean(mealDefaults.meals?.breakfast),
    lunch: Boolean(mealDefaults.meals?.lunch),
    dinner: Boolean(mealDefaults.meals?.dinner),
  };
  const mealModes: Partial<Record<SightseeingMealKey, SightseeingMealMode>> = {};
  const mealTransferDetails: Partial<Record<SightseeingMealKey, string>> = {};
  for (const meal of SIGHTSEEING_MEAL_KEYS) {
    if (meals[meal]) {
      const rawMode = mealDefaults.mealModes?.[meal];
      if (isSightseeingMealMode(rawMode)) {
        mealModes[meal] = rawMode;
      }
    }
    // Mirror the manual-selection behavior: transfer details copy over
    // whenever the master provides non-blank text, even if the meal itself
    // is disabled (the UI hides it until the meal is checked).
    const rawDetails = mealDefaults.mealTransferDetails?.[meal];
    const details = typeof rawDetails === 'string' ? rawDetails.trim() : '';
    if (details) {
      mealTransferDetails[meal] = details;
    }
  }
  const rawTransfer = mealDefaults.transfer;
  const activityTransfer = isSightseeingOverallTransfer(rawTransfer) ? rawTransfer : null;
  return { meals, mealModes, mealTransferDetails, activityTransfer };
}

/**
 * Full-replacement state for a master change. Unlike the partial overlay
 * above, this always returns complete values with canonical defaults applied,
 * so callers replacing one attraction with another can overwrite every
 * master-controlled field and leave no stale values behind:
 * - meals: master booleans, or all-false when the master configures nothing.
 * - each meal mode: valid master enum, else `NO_TRANSFER`.
 * - each meal details: non-blank master text, else null (stale details from a
 *   previous attraction are thereby removed).
 * - activity transfer: valid master enum, else null (UI falls back to day
 *   `NO_TRANSFER`).
 */
export function resolveSightseeingMealReplacement(
  master: SightseeingMasterLike | null | undefined,
): FullSightseeingMealReplacement {
  const mealDefaults = master?.mealDefaults;
  if (!mealDefaults) {
    return {
      meals: { ...EMPTY_SIGHTSEEING_MEALS },
      mealPreferences: {
        breakfast: { mode: 'NO_TRANSFER', transferDetails: null },
        lunch: { mode: 'NO_TRANSFER', transferDetails: null },
        dinner: { mode: 'NO_TRANSFER', transferDetails: null },
      },
      activityTransfer: null,
      hasMasterDefaults: false,
    };
  }
  const meals: Record<SightseeingMealKey, boolean> = {
    breakfast: Boolean(mealDefaults.meals?.breakfast),
    lunch: Boolean(mealDefaults.meals?.lunch),
    dinner: Boolean(mealDefaults.meals?.dinner),
  };
  const mealPreferences = {} as FullSightseeingMealReplacement['mealPreferences'];
  for (const meal of SIGHTSEEING_MEAL_KEYS) {
    const rawMode = mealDefaults.mealModes?.[meal];
    const rawDetails = mealDefaults.mealTransferDetails?.[meal];
    const details = typeof rawDetails === 'string' && rawDetails.trim() ? rawDetails.trim() : null;
    mealPreferences[meal] = {
      mode: isSightseeingMealMode(rawMode) ? rawMode : 'NO_TRANSFER',
      transferDetails: details,
    };
  }
  const rawTransfer = mealDefaults.transfer;
  return {
    meals,
    mealPreferences,
    activityTransfer: isSightseeingOverallTransfer(rawTransfer) ? rawTransfer : null,
    hasMasterDefaults: true,
  };
}

/** Day-level patch derived from a master — meals + per-meal preferences. */
export function buildSightseeingDayMealPatch(master: SightseeingMasterLike | null | undefined): {
  meals: Record<SightseeingMealKey, boolean> | null;
  mealPreferences: Partial<
    Record<SightseeingMealKey, { mode: SightseeingMealMode; transferDetails: string | null }>
  > | null;
} {
  const resolved = resolveSightseeingMealPrefill(master);
  if (!resolved.meals) {
    return { meals: null, mealPreferences: null };
  }
  const mealPreferences: Partial<
    Record<SightseeingMealKey, { mode: SightseeingMealMode; transferDetails: string | null }>
  > = {};
  for (const meal of SIGHTSEEING_MEAL_KEYS) {
    if (!resolved.meals[meal]) continue;
    const mode = resolved.mealModes[meal];
    if (mode) {
      mealPreferences[meal] = {
        mode,
        transferDetails: resolved.mealTransferDetails[meal] ?? null,
      };
    } else if (resolved.mealTransferDetails[meal]) {
      // Details without a valid mode are meaningless for the builder UI
      // (details only render for WITH_TRANSFER); drop them rather than
      // persisting an orphan string.
    }
  }
  return { meals: resolved.meals, mealPreferences };
}

/** Activity-level overall transfer derived from a master. */
export function buildSightseeingActivityTransfer(
  master: SightseeingMasterLike | null | undefined,
): SightseeingOverallTransfer | null {
  return resolveSightseeingMealPrefill(master).activityTransfer;
}
