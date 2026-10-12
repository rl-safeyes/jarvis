export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}
let csrfToken: string | undefined;
export function setCsrfToken(value?: string) {
  csrfToken = value;
}
export async function api<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(`/api/v1${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    credentials: 'same-origin',
    headers:
      body === undefined
        ? {}
        : {
            'Content-Type': 'application/json',
            ...(csrfToken ? { 'X-CSRF-Token': csrfToken } : {}),
          },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  if (!response.ok) {
    const result = await response.json().catch(() => null);
    throw new ApiError(
      response.status,
      result?.error?.code ?? 'request_failed',
      result?.error?.message ?? 'La demande n’a pas pu aboutir.',
    );
  }
  return response.status === 204 ? (undefined as T) : (response.json() as Promise<T>);
}

export async function transcribeAudio(
  audio: Blob,
  signal: AbortSignal,
): Promise<{ text: string; durationSec: number }> {
  const response = await fetch('/api/v1/voice/transcriptions', {
    method: 'POST',
    credentials: 'same-origin',
    signal,
    headers: { 'Content-Type': audio.type, ...(csrfToken ? { 'X-CSRF-Token': csrfToken } : {}) },
    body: audio,
  });
  if (!response.ok) {
    const result = await response.json().catch(() => null);
    throw new ApiError(
      response.status,
      result?.error?.code ?? 'voice_failed',
      response.status === 413
        ? 'La dictée dépasse la limite de 2 Mo.'
        : (result?.error?.message ?? 'La transcription a échoué. Réessayez.'),
    );
  }
  return response.json();
}
