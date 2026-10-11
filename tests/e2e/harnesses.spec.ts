import { test, expect } from '@playwright/test';
test.skip(
  process.env.E2E_LIVE !== '1',
  'Requires the isolated live Docker stack, without provider credentials.',
);
test('onboards a Docker-owned account without borrowing host authentication', async ({
  page,
}, info) => {
  await page.goto('/');
  await page.getByLabel('Mot de passe').fill(process.env.E2E_OWNER_PASSWORD!);
  await page.getByRole('button', { name: 'Ouvrir mon espace' }).click();
  await expect(page.getByRole('heading', { name: 'Les moteurs de votre Jarvis.' })).toBeVisible();
  await expect(page.getByText('Installé dans Docker').first()).toBeVisible();
  await page.getByLabel('Nom du compte', { exact: true }).fill(`E2E ${info.project.name}`);
  await page.getByRole('button', { name: 'Ajouter ce compte' }).click();
  await expect(page.getByRole('button', { name: 'Se connecter avec ChatGPT' })).toBeVisible();
  // Allow the newly created account container to finish starting.
  await expect(async () => {
    await page.getByRole('button', { name: 'Vérifier la connexion' }).click();
    await expect(page.getByRole('status')).toContainText('actualisé');
  }).toPass({ timeout: 20000 });
  await expect(page.getByLabel('Compte à connecter')).toContainText('disconnected');
  await expect(page.getByLabel('Profil par défaut', { exact: true })).toHaveValue('');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({
    path: `test-results/harness-onboarding-${info.project.name}.png`,
    fullPage: true,
  });
});
