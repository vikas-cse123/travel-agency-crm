import { describe, it, expect } from 'vitest';
import {
  quotationVersionInputSchema,
  normalizeWeblinkProfileConfig,
  WEBLINK_PROFILE_FIELD_LABELS,
  type WeblinkProfileConfig,
} from '@interscale/shared';

const baseVersion = { title: 'Test package', destinationSummary: 'Singapore', currency: 'INR' };

describe('quotationVersionInputSchema — weblink profile config', () => {
  it('accepts a full per-item profile config plus prepared by', () => {
    const parsed = quotationVersionInputSchema.parse({
      ...baseVersion,
      weblinkProfile: {
        travelerName: { label: 'Guest', value: 'The Mehtas', hidden: false },
        cwbAges: { hidden: true },
        preparedBy: {
          label: 'Your Expert',
          name: 'Ravi Kumar',
          phone: '+91 91111 22222',
          email: 'ravi@alpha.test',
        },
      },
    });
    expect(parsed.weblinkProfile?.travelerName).toEqual({
      label: 'Guest',
      value: 'The Mehtas',
      hidden: false,
    });
    expect(parsed.weblinkProfile?.preparedBy?.email).toBe('ravi@alpha.test');
  });

  it('accepts a null or absent profile config (legacy versions)', () => {
    expect(quotationVersionInputSchema.parse({ ...baseVersion }).weblinkProfile).toBeUndefined();
    expect(
      quotationVersionInputSchema.parse({ ...baseVersion, weblinkProfile: null }).weblinkProfile,
    ).toBeNull();
  });

  it('rejects an over-long label or value', () => {
    const tooLongLabel = quotationVersionInputSchema.safeParse({
      ...baseVersion,
      weblinkProfile: { duration: { label: 'x'.repeat(61) } },
    });
    expect(tooLongLabel.success).toBe(false);
    const tooLongValue = quotationVersionInputSchema.safeParse({
      ...baseVersion,
      weblinkProfile: { duration: { value: 'x'.repeat(301) } },
    });
    expect(tooLongValue.success).toBe(false);
  });
});

describe('normalizeWeblinkProfileConfig', () => {
  it('trims values, drops blanks and keeps hidden flags', () => {
    const input: WeblinkProfileConfig = {
      travelerName: { label: '  Guest  ', value: '  The Mehtas  ' },
      cwbAges: { label: '   ', value: '' },
      infantAges: { hidden: true },
      preparedBy: { name: '  Ravi  ', phone: '', label: '   ' },
    };
    expect(normalizeWeblinkProfileConfig(input)).toEqual({
      travelerName: { label: 'Guest', value: 'The Mehtas' },
      infantAges: { hidden: true },
      preparedBy: { name: 'Ravi' },
    });
  });

  it('drops an explicit empty config to null so nothing redundant is stored', () => {
    expect(normalizeWeblinkProfileConfig({ cwbAges: { label: '', value: '' } })).toBeNull();
    expect(normalizeWeblinkProfileConfig(null)).toBeNull();
    expect(normalizeWeblinkProfileConfig(undefined)).toBeNull();
  });

  it('exposes the stable default labels for every profile row', () => {
    expect(WEBLINK_PROFILE_FIELD_LABELS.travelerName).toBe('Traveler Name');
    expect(WEBLINK_PROFILE_FIELD_LABELS.destinations).toBe('Destinations');
    expect(Object.keys(WEBLINK_PROFILE_FIELD_LABELS)).toHaveLength(9);
  });
});
