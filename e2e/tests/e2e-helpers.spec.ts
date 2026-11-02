import { expect, test } from '../fixtures';
import { api, createE2eProject, e2eIdentifier, removeE2eProject, runId, variant } from '../helpers';

// The helpers of the specs themselves: an identifier that is taken already (a hash collision of two names in one run
// and variant) does not stop createE2eProject.

test('creates a project although the identifier of its name is taken', async ({ page }) => {
  await page.goto('/my-items');
  const name = `E2E helpers ${variant()} ${runId()}`;
  const taken = e2eIdentifier(name, 0);
  const blocker = await api(page, 'POST', '/api/v1/projects', { name: `E2E blocker ${variant()} ${runId()}`, identifier: taken });
  expect(blocker.status(), await blocker.text()).toBe(201);
  try {
    const project = await createE2eProject(page, name);
    expect(project.identifier).toBe(e2eIdentifier(name, 1));
    expect(project.identifier).toMatch(/^[A-Z][A-Z0-9]{1,9}$/);
    await removeE2eProject(page, project.identifier);
  } finally {
    await removeE2eProject(page, taken);
  }
});
