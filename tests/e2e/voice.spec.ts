import { test, expect, type Cookie } from '@playwright/test';
let ownerCookies: Cookie[] = [];

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const state = {
      tracks: [] as { readyState: string; stop: () => void }[],
      denied: false,
      mime: '',
    };
    (window as unknown as { voiceFixture: typeof state }).voiceFixture = state;
    Object.defineProperty(navigator.mediaDevices, 'getUserMedia', {
      value: async () => {
        if (state.denied) throw new DOMException('Denied', 'NotAllowedError');
        const track = {
          readyState: 'live',
          stop() {
            this.readyState = 'ended';
          },
        };
        state.tracks.push(track);
        return { getTracks: () => [track] };
      },
    });
    class Recorder {
      static isTypeSupported(type: string) {
        return type === 'audio/mp4';
      }
      state = 'inactive';
      mimeType = 'audio/mp4';
      ondataavailable?: (event: { data: Blob }) => void;
      onstop?: () => void;
      constructor(_stream: unknown, options: { mimeType: string }) {
        state.mime = options.mimeType;
      }
      start() {
        this.state = 'recording';
      }
      stop() {
        this.state = 'inactive';
        queueMicrotask(() => {
          this.ondataavailable?.({ data: new Blob(['test-recording'], { type: this.mimeType }) });
          this.onstop?.();
        });
      }
    }
    Object.defineProperty(window, 'MediaRecorder', { value: Recorder });
  });
  await page.route('**/api/v1/voice/status', (route) =>
    route.fulfill({ json: { state: 'ready' } }),
  );
  if (ownerCookies.length) {
    await page.context().addCookies(ownerCookies);
    await page.goto('/');
    return;
  }
  await page.goto('/');
  await page.getByLabel('Mot de passe propriétaire').fill(process.env.E2E_OWNER_PASSWORD!);
  await page.getByRole('button', { name: 'Ouvrir mon espace' }).click();
  await expect(page.getByLabel('Votre message')).toBeVisible();
  ownerCookies = await page.context().cookies();
});
test('dictation uses MP4 fallback, preserves draft, requires explicit send and releases microphone', async ({
  page,
}, info) => {
  let transcriptions = 0;
  let sends = 0;
  page.on('request', (request) => {
    if (request.url().endsWith('/messages') && request.method() === 'POST') sends++;
  });
  await page.route('**/api/v1/voice/transcriptions', async (route) => {
    transcriptions++;
    expect(route.request().headers()['content-type']).toBe('audio/mp4');
    expect(route.request().headers()['x-csrf-token']).toBeTruthy();
    await route.fulfill({ json: { text: 'Bonjour Jarvis.', durationSec: 2 } });
  });
  const draft = page.getByLabel('Votre message');
  await draft.fill('Voici ma demande :');
  await page.getByRole('button', { name: 'Dicter un message' }).click();
  await expect(page.getByRole('status')).toContainText('Écoute');
  await expect(page.getByRole('button', { name: 'Envoyer le message' })).toBeDisabled();
  await page.getByRole('button', { name: 'Terminer la dictée' }).click();
  await expect(draft).toHaveValue('Voici ma demande : Bonjour Jarvis.');
  expect(transcriptions).toBe(1);
  expect(sends).toBe(0);
  await expect(draft).toBeEnabled();
  expect(
    await page.evaluate(() =>
      (window as any).voiceFixture.tracks.every((t: any) => t.readyState === 'ended'),
    ),
  ).toBe(true);
  await page.getByRole('button', { name: 'Dicter un message' }).click();
  await page.getByRole('button', { name: 'Annuler la dictée' }).click();
  await expect(draft).toBeEnabled();
  expect(transcriptions).toBe(1);
  await expect(draft).toHaveValue('Voici ma demande : Bonjour Jarvis.');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath('voice.png'), fullPage: true });
});
test('microphone denial and inference failures leave text chat usable', async ({ page }) => {
  await page.evaluate(() => {
    (window as any).voiceFixture.denied = true;
  });
  await page.getByRole('button', { name: 'Dicter un message' }).click();
  await expect(page.getByRole('status')).toContainText('Accès au micro refusé');
  await expect(page.getByLabel('Votre message')).toBeEnabled();
  await page.evaluate(() => {
    (window as any).voiceFixture.denied = false;
  });
  await page.route('**/api/v1/voice/transcriptions', (route) =>
    route.fulfill({
      status: 504,
      json: { error: { code: 'voice_timeout', message: 'La transcription a pris trop de temps.' } },
    }),
  );
  await page.getByRole('button', { name: 'Dicter un message' }).click();
  await page.getByRole('button', { name: 'Terminer la dictée' }).click();
  await expect(page.getByRole('status')).toContainText('trop de temps');
  await expect(page.getByLabel('Votre message')).toBeEnabled();
});
test('a new conversation discards a late transcription, including from an empty conversation', async ({
  page,
}, info) => {
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('**/api/v1/voice/transcriptions', async (route) => {
    await pending;
    await route.fulfill({ json: { text: 'Late discarded text', durationSec: 2 } }).catch(() => {});
  });
  await page.getByRole('button', { name: 'Dicter un message' }).click();
  await page.getByRole('button', { name: 'Terminer la dictée' }).click();
  await expect(page.getByRole('status')).toContainText('Transcription en cours');
  if (info.project.name === 'mobile')
    await page.getByRole('button', { name: 'Ouvrir le menu' }).click();
  await page.getByRole('button', { name: 'Nouvelle conversation' }).click();
  release();
  await expect(page.getByLabel('Votre message')).toBeEnabled();
  await expect(page.getByLabel('Votre message')).toHaveValue('');
  await expect(page.locator('.voice-feedback')).not.toContainText('Transcription en cours');
});
