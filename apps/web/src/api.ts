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
