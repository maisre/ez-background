import { Injectable, Logger } from '@nestjs/common';
import { SqsMessageHandler, SqsConsumerEventHandler } from '@ssut/nestjs-sqs';
import type { Message } from '@aws-sdk/client-sqs';

@Injectable()
export class ScreenshotHandler {
  private readonly logger = new Logger(ScreenshotHandler.name);

  @SqsMessageHandler('screenshot-queue', false)
  async handleMessage(message: Message) {
    const body = JSON.parse(message.Body!);
    this.logger.log(`Processing screenshot job: ${message.MessageId}`);
    // TODO: Implement screenshot capture logic
    // body will contain e.g. { pageId, orgId, ... }
  }

  @SqsConsumerEventHandler('screenshot-queue', 'processing_error')
  onProcessingError(error: Error, message: Message) {
    this.logger.error(
      `Screenshot processing error [${message.MessageId}]: ${error.message}`,
    );
  }
}
