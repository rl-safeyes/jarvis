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
  let deployment: any = null;
  let approvals = 0;
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
    else if (p === '/release-settings')
      result = {
        settings: { controller_online: true, auto_enabled: false, revision: 0 },
        deployments: [],
      };
    else if (p === '/release-policy') result = { digest: '1'.repeat(64) };
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
          policy_digest: '1'.repeat(64),
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
    } else if (p === `/development/${id}/deployment`) {
      if (request.method() === 'POST')
        deployment = {
          id,
          state: 'awaiting_approval',
          revision: 1,
          commit: 'c'.repeat(40),
          policy_digest: '1'.repeat(64),
          image: 'sha256:' + 'a'.repeat(64),
          previous_image: 'sha256:' + 'b'.repeat(64),
          automatic: false,
        };
      result = { deployment };
    } else if (p === `/deployments/${id}/action`) {
      const body = request.postDataJSON();
      expect(body.image).toBe('sha256:' + 'a'.repeat(64));
      expect(body.commit).toBe('c'.repeat(40));
      if (body.action === 'approve') {
        approvals++;
        deployment = {
          ...deployment,
          state: 'monitoring',
          revision: 2,
          monitor_until: new Date(Date.now() + 900000).toISOString(),
        };
      } else if (body.action === 'rollback')
        deployment = { ...deployment, state: 'rolled_back', revision: 3 };
      result = { deployment };
    } else throw new Error('Unexpected route ' + p);
    await route.fulfill({ json: result });
  });
  return {
    connect: () => {
      connection = { state: 'connected', account: 'owner' };
    },
    posts: () => posts,
    qualifications: () => qualifications,
    approvals: () => approvals,
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

test('deployment approval binds the prepared image and rollback stays available on mobile', async ({
  page,
}) => {
  const f = await fixture(page);
  await page.goto('/');
  await page.getByRole('button', { name: 'Créer une pull request en brouillon' }).click();
  await page.getByRole('button', { name: 'Vérifier la préproduction' }).click();
  await page.getByRole('button', { name: 'Préparer la fusion et le déploiement' }).click();
  await expect(page.getByText('Image testée — approbation attendue')).toBeVisible();
  expect(f.approvals()).toBe(0);
  await page.getByRole('button', { name: 'Approuver la fusion et le déploiement' }).click();
  await expect(page.getByText('Nouvelle version sous surveillance')).toBeVisible();
  expect(f.approvals()).toBe(1);
  await page.reload();
  await expect(page.getByRole('button', { name: 'Restaurer la version précédente' })).toBeVisible();
  await page.getByRole('button', { name: 'Restaurer la version précédente' }).click();
  await expect(page.getByText('Version précédente restaurée', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
