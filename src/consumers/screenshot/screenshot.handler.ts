import { Inject, Injectable, Logger } from '@nestjs/common';
import { SqsMessageHandler, SqsConsumerEventHandler } from '@ssut/nestjs-sqs';
import type { Message } from '@aws-sdk/client-sqs';
import { Model } from 'mongoose';
import { ScreenshotService } from './screenshot.service.js';
import { ScreenshotJob } from './screenshot.types.js';
import {
  SHOT_PAGES_MODEL,
  SHOT_LAYOUTS_MODEL,
} from './screenshot.providers.js';

@Injectable()
export class ScreenshotHandler {
  private readonly logger = new Logger(ScreenshotHandler.name);

  constructor(
    @Inject(SHOT_PAGES_MODEL) private readonly pages: Model<any>,
    @Inject(SHOT_LAYOUTS_MODEL) private readonly layouts: Model<any>,
    private readonly screenshots: ScreenshotService,
  ) {}

  @SqsMessageHandler('screenshot-queue', false)
  async handleMessage(message: Message) {
    const job = JSON.parse(message.Body!) as ScreenshotJob;
    this.logger.log(
      `Processing screenshot job ${message.MessageId} | ${job.type} ${job.id}`,
    );

    const model = job.type === 'layout' ? this.layouts : this.pages;
    const doc = await model.findById(job.id);
    if (!doc) {
      this.logger.warn(`${job.type} ${job.id} no longer exists — dropping job`);
      return;
    }

    // Staleness guard: a newer edit landed after this job was enqueued. Drop
    // it — a later job already covers the newer state. This is what makes
    // duplicate/superseded messages harmless and completes the debounce: only
    // the job matching the settled content actually renders.
    const current = new Date(doc.contentUpdatedAt).toISOString();
    if (current !== job.contentUpdatedAt) {
      this.logger.log(
        `Skipping stale ${job.type} ${job.id} (job=${job.contentUpdatedAt}, current=${current})`,
      );
      return;
    }

    // orgId comes from the loaded doc, not the job payload, so the key can't be
    // spoofed by a stale/forged message.
    const thumbnailUrl = await this.screenshots.capture(
      job.type,
      job.id,
      String(doc.org),
    );

    // Write back ONLY screenshot fields — never contentUpdatedAt, or we'd loop.
    // Stamp screenshotAt with the captured version so this doc stops being due.
    await model.updateOne(
      { _id: job.id },
      { $set: { thumbnailUrl, screenshotAt: doc.contentUpdatedAt } },
    );
    this.logger.log(
      `Updated ${job.type} ${job.id} thumbnail -> ${thumbnailUrl}`,
    );
  }

  @SqsConsumerEventHandler('screenshot-queue', 'processing_error')
  onProcessingError(error: Error, message: Message) {
    this.logger.error(
      `Screenshot processing error [${message.MessageId}]: ${error.message}`,
    );
  }
}
