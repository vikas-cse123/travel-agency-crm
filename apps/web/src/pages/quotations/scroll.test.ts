import { describe, expect, it } from 'vitest';
import { activeScrollSpyId } from './scroll';

const sections = [{ id: 'services-include' }, { id: 'policies' }, { id: 'contact-us' }];

const tops =
  (values: Record<string, number | null>) =>
  (id: string): number | null =>
    values[id] ?? null;

const viewport = (overrides: Partial<{ scrollY: number; innerHeight: number; documentHeight: number }> = {}) => ({
  scrollY: 0,
  innerHeight: 900,
  documentHeight: 3000,
  ...overrides,
});

describe('activeScrollSpyId', () => {
  it('returns empty when there are no sections', () => {
    expect(activeScrollSpyId([], tops({}), viewport())).toBe('');
  });

  it('activates the first section at the top of the page', () => {
    expect(
      activeScrollSpyId(sections, tops({ 'services-include': 120, policies: 800, 'contact-us': 1500 }), viewport()),
    ).toBe('services-include');
  });

  it('activates the last heading at or above the trigger line while scrolling', () => {
    expect(
      activeScrollSpyId(sections, tops({ 'services-include': -600, policies: 40, 'contact-us': 900 }), viewport()),
    ).toBe('policies');
  });

  it('recognizes a heading resting exactly on the anchor-scroll line', () => {
    // Anchor scrolling lands headings on scroll-margin-top (96px), just
    // inside the 100px trigger line, so clicking a chip and scrolling agree.
    expect(
      activeScrollSpyId(sections, tops({ 'services-include': -600, policies: -200, 'contact-us': 96 }), viewport()),
    ).toBe('contact-us');
  });

  it('activates Contact Us at the bottom of the page even when its heading rests below the trigger line', () => {
    // Short trailing section: the page bottoms out with the heading at 300px,
    // far below the trigger line — the previous section must not stay green.
    expect(
      activeScrollSpyId(
        sections,
        tops({ 'services-include': -1200, policies: -500, 'contact-us': 300 }),
        viewport({ scrollY: 2100, innerHeight: 900, documentHeight: 3000 }),
      ),
    ).toBe('contact-us');
  });

  it('keeps Policies active mid-page when Contact Us is still below the trigger line', () => {
    expect(
      activeScrollSpyId(
        sections,
        tops({ 'services-include': -1200, policies: -500, 'contact-us': 300 }),
        viewport({ scrollY: 800, innerHeight: 900, documentHeight: 3000 }),
      ),
    ).toBe('policies');
  });

  it('tolerates fractional pixels at the bottom of the page', () => {
    expect(
      activeScrollSpyId(
        sections,
        tops({ 'services-include': -1200, policies: -500, 'contact-us': 300 }),
        viewport({ scrollY: 2099.4, innerHeight: 900, documentHeight: 3000 }),
      ),
    ).toBe('contact-us');
  });

  it('skips headings that are not rendered and always resolves exactly one id', () => {
    const result = activeScrollSpyId(
      sections,
      tops({ 'services-include': -100, policies: null, 'contact-us': 800 }),
      viewport(),
    );
    expect(result).toBe('services-include');
  });
});
