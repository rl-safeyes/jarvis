import { test, expect } from '@playwright/test';
test.skip(process.env.E2E_DEVELOPMENT !== '1', 'Requires isolated development fixture stack.');
test('development permission, patch, checks and review persist on desktop and mobile', async ({
  page,
}, info) => {
  test.setTimeout(180000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('response', (r) => {
    if (r.status() === 429) errors.push('HTTP 429');
  });
  await page.goto('/');
  await page.getByLabel('Mot de passe propriétaire').fill(process.env.E2E_OWNER_PASSWORD!);
  await page.getByRole('button', { name: 'Ouvrir mon espace' }).click();
  const toggle = page.getByRole('checkbox', { name: /Développer Jarvis/ });
  await expect(toggle).not.toBeChecked();
  await toggle.check();
  await page.getByLabel('Votre message').fill('mission-development : ajoute une note de recette.');
  await page.getByRole('button', { name: 'Envoyer le message' }).click();
  await expect(page.locator('.message.assistant')).toContainText('Proposition de code préparée', {
    timeout: 180000,
  });
  await expect(toggle).not.toBeChecked();
  await page.reload();
  const change = page.locator('.development-change');
  await expect(change).toContainText('Proposition prête');
  await expect(change).toContainText('Vérifications réussies');
  await expect(change).toContainText('Favorable');
  await change.getByText('Voir les modifications', { exact: true }).click();
  await expect(change).toContainText('Development fixture');
  await expect(change.getByRole('link', { name: 'Télécharger le patch' })).toHaveAttribute(
    'href',
    /\/api\/v1\/development\/.+\/patch/,
  );
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await expect(page.getByRole('alert')).toHaveCount(0);
  expect(errors).toEqual([]);
  await page.screenshot({ path: info.outputPath('development.png'), fullPage: true });
});
