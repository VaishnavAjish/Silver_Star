import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

// Unmount any React trees left over from the previous test so DOM queries in the
// next test cannot match stale nodes.
afterEach(() => {
  cleanup();
});
