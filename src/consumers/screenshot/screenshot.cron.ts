import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ConfigService } from '@nestjs/config';
import { Model } from 'mongoose';
import { ScreenshotProducer } from './screenshot.producer.js';
import { ScreenshotTarget } from './screenshot.types.js';
import {
  SHOT_PAGES_MODEL,
  SHOT_LAYOUTS_MODEL,
} from './screenshot.providers.js';

// Safety cap so a pathological query can never spin forever inside one tick.
const MAX_PER_SWEEP = 500;

// The debounce lives entirely in this scanner's query: a doc only becomes
// "due" once it has been quiet for `debounceMs` since its last content edit,
// so a burst of saves collapses into a single capture taken after edits stop.
// The cron is the trigger, not a backup — there is no separate per-save
// enqueue path to miss.
@Injectable()
export class ScreenshotCron {
  private readonly logger = new Logger(ScreenshotCron.name);

  constructor(
    @Inject(SHOT_PAGES_MODEL) private readonly pages: Model<any>,
    @Inject(SHOT_LAYOUTS_MODEL) private readonly layouts: Model<any>,
    private readonly producer: ScreenshotProducer,
    private readonly config: ConfigService,
  ) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async scan(): Promise<void> {
    if (!this.config.get<string>('aws.sqs.screenshotQueueUrl')) {
      return; // No queue configured (e.g. local without SQS) — no-op.
    }

    await this.sweep(this.pages, 'page');

    // Layouts intentionally not swept yet: ez-view has no standalone layout
    // render route, so there is nothing for the worker to screenshot. The
    // schema fields and the generic pipeline below are ready — enable this once
    // ez-view exposes `GET /view/layout/:id`.
    // await this.sweep(this.layouts, 'layout');
  }

  private async sweep(model: Model<any>, type: ScreenshotTarget): Promise<void> {
    const debounceMs = this.config.get<number>('screenshot.debounceMs', 240000);
    const leaseMs = this.config.get<number>('screenshot.leaseMs', 600000);

    const now = new Date();
    const settledBefore = new Date(now.getTime() - debounceMs);
    const leaseExpired = new Date(now.getTime() - leaseMs);

    const due = {
      status: { $ne: 'archived' },
      deletedAt: null, // also matches pre-existing docs with no such field
      contentUpdatedAt: { $lte: settledBefore }, // quiet long enough
      $and: [
        // Owed a shot: no successful capture at or after the last edit.
        // (screenshotAt null/missing sorts below any date, so this is true.)
        { $expr: { $lt: ['$screenshotAt', '$contentUpdatedAt'] } },
        // Not already covered by an in-flight enqueue, unless that enqueue was
        // for an older version or its lease has expired (render likely died).
        {
          $or: [
            { screenshotQueuedFor: null },
            { $expr: { $lt: ['$screenshotQueuedFor', '$contentUpdatedAt'] } },
            { screenshotQueuedAt: { $lt: leaseExpired } },
          ],
        },
      ],
    };

    let enqueued = 0;
    for (; enqueued < MAX_PER_SWEEP; ) {
      // Claim atomically so two ticks (or replicas) can't both enqueue the same
      // doc. Pipeline-form update so screenshotQueuedFor can copy the current
      // contentUpdatedAt. Oldest-dirty first.
      const doc = await model.findOneAndUpdate(
        due,
        [
          {
            $set: {
              screenshotQueuedFor: '$contentUpdatedAt',
              screenshotQueuedAt: now,
            },
          },
        ],
        { new: true, sort: { contentUpdatedAt: 1 } },
      );
      if (!doc) break;

      try {
        await this.producer.enqueue({
          type,
          id: doc._id.toString(),
          contentUpdatedAt: new Date(doc.contentUpdatedAt).toISOString(),
        });
        enqueued++;
      } catch (err) {
        // The claim stands; the lease will re-surface this doc after leaseMs.
        this.logger.error(
          `Failed to enqueue ${type} ${doc._id}: ${String(err)}`,
        );
        break;
      }
    }

    if (enqueued > 0) {
      this.logger.log(`Enqueued ${enqueued} ${type} screenshot job(s)`);
    }
    if (enqueued >= MAX_PER_SWEEP) {
      this.logger.warn(
        `Hit MAX_PER_SWEEP (${MAX_PER_SWEEP}) for ${type}; remaining docs wait for the next tick`,
      );
    }
  }
}
