import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { MfeProvider } from '@gears-frontx/react';
import { createMfeBridgeFixture, mfeContextValue } from '@frontx-test-utils/createMfeBridgeFixture';
import { STUDIO_SHARED_PROPERTY_CONTEXT_ORGANIZATION } from './hostProperties';
import { OrganizationProvider, useOrganization } from './organization';

/**
 * The distinction the whole write path rests on: "the shell has not said yet"
 * is not "there is no organization". The first must not let the form submit and
 * must not explain itself; the second must.
 */
const Probe: React.FC = () => {
  const { org, loading } = useOrganization();
  return <span data-testid="probe">{loading ? 'loading' : (org?.id ?? 'none')}</span>;
};

function mount(published?: unknown) {
  const { bridge } = createMfeBridgeFixture({
    domainId: 'screen',
    instanceId: 'inst',
    // Omitting the key entirely is what "the shell has not published" means:
    // `getProperty` then returns undefined, which is the state under test. The
    // cast is because the fixture types every property as a string while the
    // shell publishes this one as an object; the bridge itself does not care.
    initialProperties:
      published === undefined
        ? {}
        : { [STUDIO_SHARED_PROPERTY_CONTEXT_ORGANIZATION]: published as unknown as string },
  });
  render(
    <MfeProvider value={mfeContextValue(bridge)}>
      <OrganizationProvider>
        <Probe />
      </OrganizationProvider>
    </MfeProvider>
  );
}

describe('organization in scope', () => {
  it('reads the organization the shell published', () => {
    mount({ id: 'org-1', name: 'Acme' });
    expect(screen.getByTestId('probe').textContent).toBe('org-1');
  });

  it('waits rather than guessing while the shell has published nothing', () => {
    mount();
    expect(screen.getByTestId('probe').textContent).toBe('loading');
  });

  it('treats a value of the wrong shape as not-yet, never as an organization', () => {
    mount({ name: 'Acme' });
    expect(screen.getByTestId('probe').textContent).toBe('none');
  });
});
