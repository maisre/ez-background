import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';
import { ScreenshotJob } from './screenshot.types.js';

// Enqueues screenshot jobs. The scanner (screenshot.cron.ts) is the only
// producer; the SQS consumer in screenshot.handler.ts does the render. The
// AWS SDK reads AWS_ENDPOINT_URL from the environment, so no explicit endpoint
// is needed here to hit LocalStack.
@Injectable()
export class ScreenshotProducer {
  private readonly logger = new Logger(ScreenshotProducer.name);
  private readonly client: SQSClient;
  private readonly queueUrl: string;
  private readonly isFifo: boolean;

  constructor(config: ConfigService) {
    this.client = new SQSClient({
      region: config.get<string>('aws.region', 'us-east-1'),
    });
    this.queueUrl = config.get<string>('aws.sqs.screenshotQueueUrl', '');
    this.isFifo = this.queueUrl.endsWith('.fifo');
  }

  async enqueue(job: ScreenshotJob): Promise<void> {
    const command = new SendMessageCommand({
      QueueUrl: this.queueUrl,
      MessageBody: JSON.stringify(job),
      // On a FIFO queue, dedupe identical (id, contentUpdatedAt) enqueues within
      // the 5-minute window and serialize renders per document. On a standard
      // queue these fields are rejected, so they're only set when the queue URL
      // ends in .fifo. The consumer's staleness check makes duplicates harmless
      // regardless, so a standard queue is fine locally.
      ...(this.isFifo
        ? {
            MessageGroupId: job.id,
            MessageDeduplicationId: `${job.id}:${job.contentUpdatedAt}`,
          }
        : {}),
    });

    const result = await this.client.send(command);
    this.logger.log(
      `Enqueued ${job.type} ${job.id} (contentUpdatedAt=${job.contentUpdatedAt}) -> ${result.MessageId}`,
    );
  }
}
