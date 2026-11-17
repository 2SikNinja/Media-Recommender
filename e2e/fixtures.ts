import { test as base, expect } from "@playwright/test";

import { MockApi } from "./support/mockApi";

/** Every test gets a fresh fake API, installed before the page loads. */
export const test = base.extend<{ api: MockApi }>({
  api: [
    async ({ context }, use) => {
      const api = new MockApi();
      await api.install(context);
      await use(api);
    },
    // Installed for every test, even ones that never look at the recorded calls.
    { auto: true },
  ],
});

export { expect };
