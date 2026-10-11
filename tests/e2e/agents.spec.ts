import { test, expect } from '@playwright/test';
test.skip(process.env.E2E_AGENTS !== '1', 'Requires the isolated delegation fixture stack.');
test('creates a versioned specialist and shows delegated results on desktop and mobile', async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('response', (r) => {
    if (r.status() === 429) errors.push('Unexpected rate limit');
  });
  await page.goto('/');
  await page.getByLabel('Mot de passe propriétaire').fill(process.env.E2E_OWNER_PASSWORD!);
  await page.getByRole('button', { name: 'Ouvrir mon espace' }).click();
  if (info.project.name === 'mobile')
    await page.getByRole('button', { name: 'Ouvrir le menu' }).click();
  await page.getByRole('button', { name: /^Organisation/ }).click();
  await page.getByText('Créer un agent', { exact: true }).click();
  const name = `Analyste Interface ${info.project.name} ${Date.now()}`;
  const form = page.locator('.agent-create-form');
  await form.getByLabel('Nom de l’agent', { exact: true }).fill(name);
  await form.getByLabel('Département', { exact: true }).fill('Produit Interface');
  await form.getByLabel('Rôle', { exact: true }).fill('Analyse des parcours utilisateur.');
  await form
    .getByLabel('Instructions', { exact: true })
    .fill('Rédige les critères d’acceptation des parcours en français.');
  await form.getByRole('button', { name: 'Créer ce spécialiste' }).click();
  const card = page.locator('.agent-card').filter({ has: page.getByText(name, { exact: true }) });
  await expect(card).toContainText('PRÊT');
  await card.getByText('Instructions et versions', { exact: true }).click();
  await card
    .getByLabel(`Instructions de ${name}`)
    .fill('Rédige les critères en français et précise un exemple pour chaque critère.');
  await card.getByRole('button', { name: 'Enregistrer une version' }).click();
  await expect(card.locator('.agent-engine')).toContainText('Version 2');
  await card.getByRole('button', { name: 'Afficher l’historique' }).click();
  await expect(card.locator('summary').filter({ hasText: /^Version 1$/ })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath('agents.png'), fullPage: true });
  if (info.project.name === 'mobile')
    await page.getByRole('button', { name: 'Ouvrir le menu' }).click();
  await page.getByRole('button', { name: 'Nouvelle conversation' }).click();
  await page
    .getByLabel('Votre message')
    .fill('mission-delegation : demande les critères au spécialiste');
  await page.getByRole('button', { name: 'Envoyer le message' }).click();
  await expect(page.locator('.message.assistant')).toContainText('Résultat du spécialiste', {
    timeout: 60000,
  });
  await page.reload();
  if (info.project.name === 'mobile') await page.locator('.mobile-activity > summary').click();
  const tasks = page.locator(
    info.project.name === 'mobile'
      ? '.mobile-activity .agent-tasks'
      : '.activity-panel .agent-tasks',
  );
  await expect(tasks).toContainText('Analyste Recette');
  const child = tasks.locator('.agent-task').filter({ hasText: 'Analyste Recette' });
  await child.locator('summary').click();
  await expect(child).toContainText('trois critères vérifiables');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await expect(page.getByRole('alert')).toHaveCount(0);
  expect(errors).toEqual([]);
  await page.screenshot({ path: info.outputPath('delegation.png'), fullPage: true });
});
