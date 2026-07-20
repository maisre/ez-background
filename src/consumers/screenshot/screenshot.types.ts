// Payload carried on the screenshot SQS queue. `contentUpdatedAt` is the ISO
// value the doc had when it was enqueued; the consumer compares it against the
// current doc so a job that a newer edit has already superseded is dropped
// instead of rendering stale content.
export type ScreenshotTarget = 'page' | 'layout';

export interface ScreenshotJob {
  type: ScreenshotTarget;
  id: string;
  contentUpdatedAt: string;
}
