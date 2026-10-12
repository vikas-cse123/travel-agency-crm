import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { VerticalBarChart } from './VerticalBarChart';
import { HorizontalBarChart } from './HorizontalBarChart';
import { DonutChart } from './DonutChart';

const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);

afterEach(() => {
  consoleError.mockClear();
});

function expectNoDuplicateKeyWarning() {
  expect(
    consoleError.mock.calls.some(([message]) =>
      String(message).includes('Encountered two children with the same key'),
    ),
  ).toBe(false);
}

describe('dashboard charts with duplicate labels', () => {
  it('renders every vertical bar when destinations share a name', () => {
    render(
      <VerticalBarChart
        data={[
          { label: 'GOA', value: 70000 },
          { label: 'GOA', value: 50000 },
        ]}
        formatValue={(value) => `₹${value}`}
      />,
    );
    // Both same-named destinations render as distinct bars with their own values.
    expect(screen.getAllByText('GOA')).toHaveLength(2);
    expect(screen.getByText('₹70000')).toBeInTheDocument();
    expect(screen.getByText('₹50000')).toBeInTheDocument();
    // Keys are unique per row even though labels repeat.
    expectNoDuplicateKeyWarning();
    expect(
      screen.getByRole('img', { name: 'GOA: ₹70000, GOA: ₹50000' }),
    ).toBeInTheDocument();
  });

  it('renders every horizontal row when labels repeat', () => {
    render(
      <HorizontalBarChart
        data={[
          { label: 'GOA', value: 15 },
          { label: 'GOA', value: 9 },
        ]}
      />,
    );
    expect(screen.getAllByText('GOA')).toHaveLength(2);
    expect(screen.getByText('15')).toBeInTheDocument();
    expect(screen.getByText('9')).toBeInTheDocument();
    expectNoDuplicateKeyWarning();
  });

  it('renders every donut slice when labels repeat', () => {
    const { container } = render(
      <DonutChart
        data={[
          { label: 'Website', value: 12 },
          { label: 'Website', value: 8 },
        ]}
      />,
    );
    expect(container.querySelectorAll('circle')).toHaveLength(2);
    expect(screen.getByText('20')).toBeInTheDocument();
    expectNoDuplicateKeyWarning();
  });
});
