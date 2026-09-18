/** Structured error with public code + safe message. */
export class AppError extends Error {
  constructor(
    public code: string,
    message: string,
    public statusCode = 400,
    public details?: unknown,
  ) {
    super(message);
  }
}

export const Errors = {
  unauthorized: (m = 'Not authenticated') => new AppError('UNAUTHORIZED', m, 401),
  forbidden: (m = 'Forbidden') => new AppError('FORBIDDEN', m, 403),
  notFound: (m = 'Not found') => new AppError('NOT_FOUND', m, 404),
  badRequest: (code: string, m: string, details?: unknown) =>
    new AppError(code, m, 400, details),
  conflict: (code: string, m: string) => new AppError(code, m, 409),
  tooLarge: (m: string) => new AppError('FILE_TOO_LARGE', m, 413),
  unsupported: (m: string) => new AppError('UNSUPPORTED_FORMAT', m, 415),
  internal: (m = 'Internal error') => new AppError('INTERNAL', m, 500),
};

/** Map Zod/service errors to safe API payload. */
export function toApiError(e: unknown, isProd: boolean) {
  if (e instanceof AppError) {
    return {
      status: e.statusCode,
      body: { error: e.message, code: e.code, details: e.details },
    };
  }
  const msg = e instanceof Error ? e.message : 'Internal error';
  return {
    status: 500,
    body: {
      error: isProd ? 'Internal error' : msg,
      code: 'INTERNAL',
    },
  };
}
