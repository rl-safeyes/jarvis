import { test, expect } from '@playwright/test';
const id = '538c9b34-75ca-4a5d-9b0a-aa3a1098d851';
const digest = 'a'.repeat(64);
async function fixture(page: any) {
  let connection: any = { state: 'disconnected' };
  let settings: any = { repository: null, base_branch: 'main', revision: 0 };
  let publication: any = null;
  let posts = 0;
  let release: any = null;
  let qualifications = 0;
  const conversation = {
    id,
    title: 'Proposition GitHub',
    version: 1,
    created_at: new Date().toISOString(),
  };
  await page.addInitScript((id: string) => localStorage.setItem('jarvis.conversation', id), id);
  await page.route('**/api/v1/**', async (route: any) => {
    const request = route.request();
    const p = new URL(request.url()).pathname.replace('/api/v1', '');
    let result: any;
    if (p === '/auth/session')
      result = {
        authenticated: true,
        csrf_token: 'fixture-csrf',
        mode: 'mock',
        expires_at: new Date(Date.now() + 60000).toISOString(),
      };
    else if (p === '/conversations') result = { conversations: [conversation] };
    else if (p === `/conversations/${id}`)
      result = {
        conversation,
        messages: [],
        missions: [],
        changes: [
          {
            id,
            mission_id: id,
            status: 'proposed',
            task: 'Ajouter une explication',
            image_digest: 'sha256:fixture',
            source: { repository: 'owner/repo', branch: 'main', commit: 'b'.repeat(40) },
            artifact: { patch: 'fixture diff', digest, files: ['README.md'] },
            validation: { passed: true, output: 'Checks passed' },
            review: { verdict: 'approve', summary: 'Revue favorable' },
            error: null,
          },
        ],
      };
    else if (p === '/agents') result = { agents: [], departments: [] };
    else if (p === '/voice/status') result = { state: 'disabled' };
    else if (p === '/harnesses')
      result = {
        harnesses: [],
        accounts: [],
        profiles: [],
        settings: { default_profile_id: null, revision: 0 },
        agents: [],
        operations: [],
      };
    else if (p === '/github') result = { settings, connection };
    else if (p === '/github/connect') {
      expect(request.headers()['x-csrf-token']).toBe('fixture-csrf');
      connection = {
        state: 'connecting',
        login: {
          code: 'ABCD-1234',
          verification_url: 'https://github.com/login/device',
          expires_at: new Date(Date.now() + 600000).toISOString(),
        },
      };
      result = connection;
    } else if (p === '/github/repository') {
      const input = request.postDataJSON();
      expect(input.repository).toBe('owner/repo');
      expect(input.branch).toBe('main');
      settings = { repository: input.repository, base_branch: input.branch, revision: 1 };
      result = settings;
    } else if (p === `/development/${id}/github`) {
      if (request.method() === 'POST') {
        expect(request.postDataJSON()).toEqual({ digest });
        posts++;
        publication = { state: 'queued' };
      } else if (publication?.state === 'queued')
        publication = {
          state: 'succeeded',
          result: {
            number: 12,
            url: 'https://github.com/owner/repo/pull/12',
            state: 'open',
            commit: 'c'.repeat(40),
          },
        };
      result = { publication };
    } else if (p === `/development/${id}/release`) {
      if (request.method() === 'POST') {
        expect(request.postDataJSON()).toEqual({ digest, commit: 'c'.repeat(40) });
        qualifications++;
        release = {
          state: 'passed',
          commit: 'c'.repeat(40),
          checked_at: new Date().toISOString(),
          policy_version: 'release-readiness-v1',
          blockers: [],
          risk: { level: 'low', reasons: ['Documentation uniquement'], files: 1, lines: 2 },
          checks: [
            { name: 'check', passed: true },
            { name: 'preproduction', passed: true },
          ],
          run: { url: 'https://github.com/owner/repo/actions/runs/42', attempt: 1 },
        };
      }
      result = { report: release, stale: false };
    } else throw new Error('Unexpected route ' + p);
    await route.fulfill({ json: result });
  });
  return {
    connect: () => {
      connection = { state: 'connected', account: 'owner' };
    },
    posts: () => posts,
    qualifications: () => qualifications,
  };
}
test('GitHub browser connection, repository setup and guide work on desktop and mobile', async ({
  page,
}, info) => {
  const f = await fixture(page);
  await page.goto('/');
  if (info.project.name === 'mobile')
    await page.getByRole('button', { name: 'Ouvrir le menu' }).click();
  await page.getByRole('button', { name: /^Réglages/ }).click();
  const region = page.getByRole('region', { name: 'Connexion GitHub' });
  await region.getByRole('button', { name: 'Se connecter à GitHub dans le navigateur' }).click();
  await expect(region).toContainText('ABCD-1234');
  await expect(region.getByRole('link', { name: 'Ouvrir la connexion GitHub' })).toHaveAttribute(
    'href',
    'https://github.com/login/device',
  );
  f.connect();
  await expect(region).toContainText('Connecté avec owner', { timeout: 7000 });
  await region.getByLabel('Dépôt GitHub').fill('owner/repo');
  await region.getByRole('button', { name: 'Vérifier et enregistrer le dépôt' }).click();
  await expect(region).toContainText('Prochaines missions : owner/repo');
  await region.getByText('Comment fonctionne l’accès GitHub ?').click();
  await expect(region).toContainText('aucun jeton');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await region.screenshot({ path: info.outputPath('github-settings.png') });
});
test('reviewed patch publication is explicit and the PR link survives reload', async ({
  page,
}, info) => {
  const f = await fixture(page);
  await page.goto('/');
  const change = page.getByRole('region', { name: 'Propositions de code' });
  await expect(change).toContainText('Proposition prête');
  expect(f.posts()).toBe(0);
  await change.getByRole('button', { name: 'Créer une pull request en brouillon' }).click();
  await expect(change.getByRole('link', { name: 'Ouvrir la pull request #12' })).toHaveAttribute(
    'href',
    'https://github.com/owner/repo/pull/12',
  );
  expect(f.posts()).toBe(1);
  await page.reload();
  await expect(change.getByRole('link', { name: 'Ouvrir la pull request #12' })).toBeVisible();
  expect(f.posts()).toBe(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await change.screenshot({ path: info.outputPath('github-pr.png') });
});

test('preproduction report requires explicit refresh and persists after reload', async ({
  page,
}, info) => {
  const f = await fixture(page);
  await page.goto('/');
  await page.getByRole('button', { name: 'Créer une pull request en brouillon' }).click();
  const region = page.getByRole('region', { name: 'Préparation de la release' });
  await expect(region).toBeVisible();
  expect(f.qualifications()).toBe(0);
  await region.getByRole('button', { name: 'Vérifier la préproduction' }).click();
  await expect(region).toContainText('Préproduction validée');
  await expect(region).toContainText('Risque : faible');
  await expect(region.getByRole('link', { name: 'Voir les contrôles GitHub' })).toHaveAttribute(
    'href',
    'https://github.com/owner/repo/actions/runs/42',
  );
  await page.reload();
  await expect(region).toContainText('Préproduction validée');
  expect(f.qualifications()).toBe(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await region.screenshot({ path: info.outputPath('preproduction.png') });
});
