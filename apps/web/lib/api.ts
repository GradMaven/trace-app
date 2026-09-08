export const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api/v1';

export interface ApiResult<T> {
  ok: boolean;
  status: number;
  data: T | null;
  error?: { code: string; message: string; requestId?: string };
}

export async function parseResult<T>(res: Response): Promise<ApiResult<T>> {
  const status = res.status;
  if (status === 204) return { ok: true, status, data: null };
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  if (!res.ok) {
    const err = (body as { error?: { code: string; message: string; requestId?: string } })?.error;
    return {
      ok: false,
      status,
      data: null,
      error: err ?? { code: 'unknown', message: `Request failed (${status}).` },
    };
  }
  return { ok: true, status, data: body as T };
}
