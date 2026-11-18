import type { Message } from '@aws-sdk/client-sqs';
import { ScreenshotHandler } from './screenshot.handler.js';

describe('ScreenshotHandler', () => {
  const edited = new Date('2026-11-01T10:00:00.000Z');
  let doc: Record<string, any>;
  let capture: jest.Mock;
  let updateOne: jest.Mock;
  let handler: ScreenshotHandler;

  const message = (): Message => ({
    MessageId: 'm1',
    Body: JSON.stringify({
      type: 'page',
      id: 'p1',
      contentUpdatedAt: edited.toISOString(),
    }),
  });

  beforeEach(() => {
    doc = { _id: 'p1', org: 'o1', contentUpdatedAt: edited, screenshotAt: null };
    capture = jest.fn().mockResolvedValue('https://cdn/thumb.webp');
    updateOne = jest.fn().mockResolvedValue({});
    const pages = { findById: jest.fn(async () => doc), updateOne };
    handler = new ScreenshotHandler(pages as any, {} as any, { capture } as any);
  });

  it('renders a version that has not been captured', async () => {
    await handler.handleMessage(message());
    expect(capture).toHaveBeenCalledTimes(1);
    expect(updateOne).toHaveBeenCalled();
  });

  it('skips a re-enqueued job for a version already captured', async () => {
    doc.screenshotAt = edited;
    await handler.handleMessage(message());
    expect(capture).not.toHaveBeenCalled();
    expect(updateOne).not.toHaveBeenCalled();
  });

  it('still renders when the last capture predates the edit', async () => {
    doc.screenshotAt = new Date(edited.getTime() - 1000);
    await handler.handleMessage(message());
    expect(capture).toHaveBeenCalledTimes(1);
  });

  it('skips a document deleted or archived after it was queued', async () => {
    doc.deletedAt = new Date();
    await handler.handleMessage(message());
    doc.deletedAt = null;
    doc.status = 'archived';
    await handler.handleMessage(message());
    expect(capture).not.toHaveBeenCalled();
    expect(updateOne).not.toHaveBeenCalled();
  });
});
