import type { ErrorResponse } from 'resend';
import {
  EmailService,
  RetryableEmailError,
  isRetryableResendError,
} from './email.service.js';

const err = (statusCode: number | null, name = 'application_error'): ErrorResponse =>
  ({ statusCode, name, message: 'x' }) as ErrorResponse;

describe('isRetryableResendError', () => {
  it.each([null, 401, 403, 429, 500, 503])('retries %s', (status) => {
    expect(isRetryableResendError(err(status))).toBe(true);
  });

  it.each([400, 404, 422])('drops %s', (status) => {
    expect(isRetryableResendError(err(status))).toBe(false);
  });
});

describe('EmailService send outcomes', () => {
  const userModel = {
    findById: () => ({ exec: async () => ({ email: 'a@example.com' }) }),
  };
  let send: jest.Mock;
  let service: EmailService;

  beforeEach(() => {
    service = new EmailService('re_test', {} as any, userModel as any);
    send = jest.fn();
    (service as any).resend = { emails: { send } };
  });

  const welcome = { type: 'welcome_email', userId: 'u1', email: 'a@example.com' };

  it('passes the SQS message id as the idempotency key', async () => {
    send.mockResolvedValue({ data: { id: 'e1' }, error: null });
    await service.handleMessage(welcome, 'msg-1');
    expect(send.mock.calls[0][1]).toEqual({ idempotencyKey: 'msg-1' });
  });

  it('throws on a quota/rate-limit error so SQS redelivers', async () => {
    send.mockResolvedValue({ data: null, error: err(429, 'daily_quota_exceeded') });
    await expect(service.handleMessage(welcome, 'm')).rejects.toBeInstanceOf(
      RetryableEmailError,
    );
  });

  it('throws when the request itself fails', async () => {
    send.mockRejectedValue(new Error('ECONNRESET'));
    await expect(service.handleMessage(welcome, 'm')).rejects.toBeInstanceOf(
      RetryableEmailError,
    );
  });

  it('drops a permanent error instead of retrying forever', async () => {
    send.mockResolvedValue({ data: null, error: err(422, 'validation_error') });
    await expect(service.handleMessage(welcome, 'm')).resolves.toBeUndefined();
  });
});
