import { test, expect } from '@playwright/test';
test('owner logs in, runs a persisted simulation, reloads and explores agents', async ({
  page,
}, testInfo) => {
  const password = process.env.E2E_OWNER_PASSWORD;
  if (!password) throw new Error('E2E_OWNER_PASSWORD est requis pour les tests navigateur.');
  await page.goto('/');
  await page.getByLabel('Mot de passe propriétaire').fill(password);
  await page.getByRole('button', { name: 'Ouvrir mon espace' }).click();
  await expect(page.getByRole('heading', { name: 'Jarvis', exact: true })).toBeVisible();
  await expect(page.getByText('Mode démonstration')).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('welcome.png'), fullPage: true });
  const message = `Organiser ma mission ${testInfo.project.name} ${Date.now()}`;
  await page.getByLabel('Votre message').fill(message);
  await page.getByRole('button', { name: 'Envoyer le message' }).click();
  await expect(page.locator('.message.assistant')).toContainText('aucun modèle IA', {
    timeout: 15000,
  });
  await page.reload();
  await expect(page.locator('.message.user')).toHaveText(new RegExp(message));
  await expect(page.locator('.message.assistant')).toHaveCount(1);
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth,
  );
  expect(overflow).toBe(false);
  await page.screenshot({ path: testInfo.outputPath('conversation.png'), fullPage: true });
  if (testInfo.project.name === 'mobile')
    await page.getByRole('button', { name: 'Ouvrir le menu' }).click();
  await page.getByRole('button', { name: 'Nouvelle conversation' }).click();
  await page.getByLabel('Votre message').fill('Une mission à arrêter');
  await page.getByRole('button', { name: 'Envoyer le message' }).click();
  await page.getByRole('button', { name: 'Arrêter la mission' }).click();
  await expect(page.locator('.message.assistant')).toHaveCount(0);
  if (testInfo.project.name === 'mobile')
    await expect(page.locator('.mobile-activity summary')).toContainText('arrêtée');
  else await expect(page.locator('.mission-status')).toHaveText('Arrêtée');
  // The server accepts the message, but the browser loses the HTTP response.
  if (testInfo.project.name === 'mobile')
    await page.getByRole('button', { name: 'Ouvrir le menu' }).click();
  await page.getByRole('button', { name: 'Nouvelle conversation' }).click();
  await page.route('**/api/v1/conversations/*/messages', async (route) => {
    await route.fetch();
    await route.abort('failed');
  });
  await page.getByLabel('Votre message').fill('Une demande dont la réponse réseau est perdue');
  await page.getByRole('button', { name: 'Envoyer le message' }).click();
  await expect(page.getByRole('alert')).toBeVisible();
  await page.unroute('**/api/v1/conversations/*/messages');
  await page.reload();
  await expect(page.locator('.message.assistant')).toHaveCount(1, { timeout: 15000 });
  const retryResponse = page.waitForResponse(
    (response) => response.url().endsWith('/messages') && response.request().method() === 'POST',
  );
  await page.getByRole('button', { name: 'Envoyer le message' }).click();
  expect((await retryResponse).status()).toBe(202);
  await expect(page.getByLabel('Votre message')).toHaveValue('');
  await expect(page.locator('.message.user')).toHaveCount(1);
  await expect(page.locator('.message.assistant')).toHaveCount(1);
  if (testInfo.project.name === 'mobile')
    await page.getByRole('button', { name: 'Ouvrir le menu' }).click();
  await page.getByRole('button', { name: /^Organisation/ }).click();
  await expect(page.getByRole('heading', { name: 'Une équipe, un orchestrateur.' })).toBeVisible();
  await expect(page.getByText('claude-code', { exact: true })).toBeVisible();
});
