import test from 'node:test';
import assert from 'node:assert/strict';
import { SpeechToText, silenceWav, MAX_AUDIO_BYTES } from '../../apps/api/src/voice.ts';

async function ready(request: typeof fetch) {
  const engine = new SpeechToText(
    { url: 'http://whisper:8000', model: 'Systran/faster-whisper-small' },
    request,
  );
  engine.prepare();
  for (let i = 0; i < 100; i++) {
    if ((await engine.status()).state === 'ready') return engine;
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
  throw new Error('Engine not ready');
}
const ok = () => Response.json({ text: ' Bonjour Jarvis. ', duration: 1.2 });
test('STT uses French faster-whisper multipart and requires verified duration', async () => {
  const calls: { url: string; init?: RequestInit }[] = [];
  const engine = await ready(async (url, init) => {
    calls.push({ url: String(url), init });
    return String(url).endsWith('/health') ? new Response() : ok();
  });
  try {
    assert.deepEqual(await engine.transcribe(silenceWav(), 'audio/mp4;codecs=mp4a.40.2'), {
      text: 'Bonjour Jarvis.',
      durationSec: 1.2,
    });
    const call = calls.at(-1)!;
    assert.equal(call.url, 'http://whisper:8000/v1/audio/transcriptions');
    const body = call.init!.body as FormData;
    assert.equal(body.get('language'), 'fr');
    assert.equal(body.get('model'), 'Systran/faster-whisper-small');
    assert.equal(body.get('vad_filter'), 'true');
    assert.equal(body.get('response_format'), 'verbose_json');
    assert.equal((body.get('file') as File).name, 'audio.m4a');
    assert.equal((body.get('file') as File).type, 'audio/mp4');
    await assert.rejects(engine.transcribe(Buffer.alloc(0), 'audio/webm'), { code: 'voice_empty' });
    await assert.rejects(engine.transcribe(Buffer.alloc(MAX_AUDIO_BYTES + 1), 'audio/webm'), {
      code: 'voice_size',
    });
    await assert.rejects(engine.transcribe(silenceWav(), 'text/html'), { code: 'voice_format' });
  } finally {
    engine.close();
  }
});
test('STT sanitizes upstream errors, empty speech, duration, malformed responses and timeouts', async () => {
  let response: () => Response = ok;
  const engine = await ready(async () => response());
  try {
    response = () => Response.json({ text: '', duration: 0.5 });
    assert.equal((await engine.transcribe(silenceWav(), 'audio/wav')).text, '');
    for (const [value, code] of [
      [{ text: 'Long', duration: 61 }, 'voice_duration'],
      [{ text: 'No duration' }, 'voice_response'],
      [null, 'voice_response'],
    ] as const) {
      response = () => Response.json(value);
      await assert.rejects(engine.transcribe(silenceWav(), 'audio/wav'), { code });
    }
    for (const status of [400, 415, 422, 404, 500]) {
      response = () => new Response('secret-internal-provider-details', { status });
      await assert.rejects(engine.transcribe(silenceWav(), 'audio/wav'), (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.ok(!error.message.includes('secret'));
        assert.equal(
          (error as Error & { code: string }).code,
          [400, 415, 422].includes(status) ? 'voice_decode' : 'voice_engine',
        );
        return true;
      });
    }
    response = () => {
      throw new DOMException('internal address', 'TimeoutError');
    };
    await assert.rejects(engine.transcribe(silenceWav(), 'audio/wav'), { code: 'voice_timeout' });
  } finally {
    engine.close();
  }
});
test('STT accepts only one inference at a time and frees the slot on failure', async () => {
  let pending = false;
  let resolve!: (value: Response) => void;
  const engine = await ready(async () =>
    pending
      ? new Promise<Response>((r) => {
          resolve = r;
        })
      : ok(),
  );
  try {
    pending = true;
    const first = engine.transcribe(silenceWav(), 'audio/wav');
    await assert.rejects(engine.transcribe(silenceWav(), 'audio/wav'), { code: 'voice_busy' });
    resolve(new Response('', { status: 500 }));
    await assert.rejects(first, { code: 'voice_engine' });
    pending = false;
    assert.equal((await engine.transcribe(silenceWav(), 'audio/wav')).text, 'Bonjour Jarvis.');
  } finally {
    engine.close();
  }
});
