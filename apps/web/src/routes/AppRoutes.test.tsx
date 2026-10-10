import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { describe, expect, it } from 'vitest';
import { Navigate } from 'react-router-dom';
import { AppRoutes } from './AppRoutes';

/**
 * Collects every `path` prop from the route table by walking the element tree.
 * AppRoutes is a pure element factory — calling it never mounts any page, so
 * no auth/fetch mocks are needed.
 */
function collectPaths(node: ReactNode, acc: string[] = []): string[] {
  if (Array.isArray(node)) {
    for (const child of node) collectPaths(child, acc);
    return acc;
  }
  if (!isValidElement(node)) return acc;
  const props = node.props as { path?: string; children?: ReactNode };
  if (typeof props.path === 'string') acc.push(props.path);
  collectPaths(props.children, acc);
  return acc;
}

// The sidebar entries for Bookings and Quotation Templates are temporarily
// hidden, but their routes must keep working when opened directly by URL.
describe('AppRoutes route table', () => {
  const tree = (AppRoutes as () => ReactElement)();
  const paths = collectPaths(tree);

  // Every `path` mapped to its rendered element, so retirement redirects can
  // be asserted (a retired path must render <Navigate to="/dashboard" />).
  function collectElements(
    node: ReactNode,
    acc: Array<{ path: string | undefined; element: unknown }> = [],
  ) {
    if (Array.isArray(node)) {
      for (const child of node) collectElements(child, acc);
      return acc;
    }
    if (!isValidElement(node)) return acc;
    const props = node.props as { path?: string; element?: unknown; children?: ReactNode };
    acc.push({ path: props.path, element: props.element });
    collectElements(props.children, acc);
    return acc;
  }
  const elements = collectElements(tree);

  it('keeps the Booking routes registered', () => {
    expect(paths).toContain('/bookings');
    expect(paths).toContain('/bookings/new');
    expect(paths).toContain('/bookings/:bookingId');
    expect(paths).toContain('/quotations/:quotationId/convert-to-booking');
  });

  it('keeps the Quotation Template routes registered', () => {
    expect(paths).toContain('/quotation-templates');
    expect(paths).toContain('/quotation-templates/new');
    expect(paths).toContain('/quotation-templates/:templateId');
    expect(paths).toContain('/quotation-templates/:templateId/edit');
  });

  it('keeps the Leads route registered', () => {
    expect(paths).toContain('/queries');
  });

  it('retires the standalone Customers/Vendors pages via dashboard redirects', () => {
    const retired = [
      '/customers',
      '/customers/new',
      '/customers/:customerId',
      '/customers/:customerId/edit',
      '/vendors',
      '/vendors/new',
      '/vendors/:vendorId',
      '/vendors/:vendorId/edit',
      '/vendors/:vendorId/services',
      '/vendors/:vendorId/services/new',
      '/vendors/:vendorId/services/:serviceId/edit',
    ];
    for (const path of retired) {
      const found = elements.filter((entry) => entry.path === path);
      expect(found.length).toBeGreaterThan(0);
      for (const entry of found) {
        expect(isValidElement(entry.element)).toBe(true);
        const element = entry.element as ReactElement;
        expect(element.type).toBe(Navigate);
        expect((element.props as { to?: string }).to).toBe('/dashboard');
      }
    }
  });
});
