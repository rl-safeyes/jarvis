import type { FastifyInstance } from 'fastify';
import { DomainError } from '@jarvis/storage';

export const MAX_AUDIO_BYTES = 2 * 1024 * 1024;
export const MAX_AUDIO_SECONDS = 60;
const extensions: Record<string, string> = {
  'audio/webm': 'webm',
  'video/webm': 'webm',
  'audio/ogg': 'ogg',
  'audio/mp4': 'm4a',
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
};
export const audioMime = (value: string) => value.split(';')[0]!.trim().toLowerCase();
export interface VoiceOptions {
  url: string;
  model: string;
}
export class SpeechToText {
  private busy = false;
  private preparing?: Promise<void>;
  private retryAt = 0;
  private state: 'preparing' | 'ready' | 'unavailable' = 'preparing';
  private shutdown = new AbortController();
  constructor(
    private options: VoiceOptions,
    private request: typeof fetch = fetch,
  ) {}
  close() {
    this.shutdown.abort();
  }
  private async call(path: string, init: RequestInit, timeout: number) {
    try {
      return await this.request(`${this.options.url.replace(/\/$/, '')}${path}`, {
        ...init,
        signal: AbortSignal.any([this.shutdown.signal, AbortSignal.timeout(timeout)]),
      });
    } catch (error) {
      if (error instanceof Error && error.name === 'TimeoutError')
        throw new DomainError(
          504,
          'voice_timeout',
          'La transcription a pris trop de temps. Essayez une dictée plus courte.',
        );
      throw new DomainError(
        503,
        'voice_unavailable',
        'Le moteur vocal est indisponible. Réessayez dans un instant.',
      );
    }
  }
  prepare() {
    if (
      this.preparing ||
      this.state === 'ready' ||
      Date.now() < this.retryAt ||
      this.shutdown.signal.aborted
    )
      return;
    this.state = 'preparing';
    this.preparing = (async () => {
      try {
        const path = this.options.model.split('/').map(encodeURIComponent).join('/');
        const pull = await this.call(`/v1/models/${path}`, { method: 'POST' }, 300_000);
        // Existing models may return 409. Transcription is the readiness check.
        await pull.body?.cancel();
        await this.transcribeAudio(silenceWav(), 'audio/wav', 300_000);
        this.state = 'ready';
      } catch {
        this.state = 'unavailable';
        this.retryAt = Date.now() + 30_000;
      } finally {
        this.preparing = undefined;
      }
    })();
  }
  async status() {
    this.prepare();
    if (this.state === 'ready') {
      try {
        const response = await this.call('/health', {}, 2000);
        await response.body?.cancel();
        if (!response.ok) throw new Error('health');
      } catch {
        this.state = 'unavailable';
        this.retryAt = Date.now() + 30_000;
      }
    }
    return {
      state: this.state,
      max_audio_seconds: MAX_AUDIO_SECONDS,
      max_audio_bytes: MAX_AUDIO_BYTES,
    };
  }
  async transcribe(buffer: Buffer, mime: string) {
    mime = audioMime(mime);
    if (!extensions[mime])
      throw new DomainError(415, 'voice_format', 'Format audio non pris en charge.');
    if (!buffer.length) throw new DomainError(400, 'voice_empty', 'L’enregistrement est vide.');
    if (buffer.length > MAX_AUDIO_BYTES)
      throw new DomainError(413, 'voice_size', 'La dictée dépasse la limite de 2 Mo.');
    if (this.state !== 'ready') {
      this.prepare();
      throw new DomainError(
        503,
        'voice_preparing',
        'Le moteur vocal se prépare. Réessayez dans un instant.',
      );
    }
    if (this.busy) throw new DomainError(429, 'voice_busy', 'Une transcription est déjà en cours.');
    this.busy = true;
    try {
      return await this.transcribeAudio(buffer, mime, 30_000);
    } finally {
      this.busy = false;
    }
  }
  private async transcribeAudio(buffer: Buffer, mime: string, timeout: number) {
    const form = new FormData();
    form.append(
      'file',
      new Blob([new Uint8Array(buffer)], { type: mime }),
      `audio.${extensions[mime]}`,
    );
    form.append('model', this.options.model);
    form.append('language', 'fr');
    form.append('response_format', 'verbose_json');
    form.append('vad_filter', 'true');
    const response = await this.call(
      '/v1/audio/transcriptions',
      { method: 'POST', body: form },
      timeout,
    );
    if (!response.ok) {
      await response.body?.cancel();
      if ([400, 415, 422].includes(response.status))
        throw new DomainError(
          400,
          'voice_decode',
          'Cet enregistrement audio ne peut pas être décodé.',
        );
      throw new DomainError(
        502,
        'voice_engine',
        'Le moteur de transcription a rencontré une erreur.',
      );
    }
    let data: { text?: unknown; duration?: unknown };
    try {
      data = (await response.json()) as typeof data;
    } catch {
      throw new DomainError(502, 'voice_response', 'Réponse du moteur vocal invalide.');
    }
    if (
      !data ||
      typeof data.text !== 'string' ||
      data.text.length > 8000 ||
      typeof data.duration !== 'number' ||
      !Number.isFinite(data.duration) ||
      data.duration < 0
    )
      throw new DomainError(502, 'voice_response', 'Réponse du moteur vocal invalide.');
    if (data.duration > MAX_AUDIO_SECONDS)
      throw new DomainError(400, 'voice_duration', 'La dictée doit durer au maximum 60 secondes.');
    return { text: data.text.trim(), durationSec: Math.round(data.duration * 10) / 10 };
  }
}
export function silenceWav() {
  const dataSize = 16_000;
  const buffer = Buffer.alloc(44 + dataSize);
  buffer.write('RIFF');
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write('WAVE', 8);
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(16000, 24);
  buffer.writeUInt32LE(32000, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataSize, 40);
  return buffer;
}
export async function registerVoiceRoutes(app: FastifyInstance, options?: VoiceOptions) {
  const engine = options ? new SpeechToText(options) : undefined;
  // Encapsulation keeps the binary parser and its size limit confined to voice routes.
  await app.register(async (voice) => {
    voice.addContentTypeParser(
      /^(audio\/(webm|ogg|mp4|wav|x-wav)|video\/webm)(;.*)?$/i,
      { parseAs: 'buffer', bodyLimit: MAX_AUDIO_BYTES },
      (_req, body, done) => done(null, body),
    );
    voice.get('/api/v1/voice/status', async () =>
      engine ? engine.status() : { state: 'disabled' },
    );
    voice.post(
      '/api/v1/voice/transcriptions',
      {
        bodyLimit: MAX_AUDIO_BYTES,
        config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
      },
      async (request) => {
        if (!engine)
          throw new DomainError(
            503,
            'voice_disabled',
            'La dictée n’est pas configurée sur ce serveur.',
          );
        if (!Buffer.isBuffer(request.body))
          throw new DomainError(415, 'voice_format', 'Un enregistrement audio est attendu.');
        return engine.transcribe(request.body, request.headers['content-type'] ?? '');
      },
    );
    voice.addHook('onReady', async () => {
      engine?.prepare();
    });
    voice.addHook('onClose', async () => {
      engine?.close();
    });
  });
}
