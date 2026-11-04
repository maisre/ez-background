import { Injectable, Logger } from '@nestjs/common';
import { SqsMessageHandler, SqsConsumerEventHandler } from '@ssut/nestjs-sqs';
import type { Message } from '@aws-sdk/client-sqs';
import * as Sentry from '@sentry/nestjs';
import { EmailService } from './email.service.js';

@Injectable()
export class EmailHandler {
  private readonly logger = new Logger(EmailHandler.name);

  constructor(private readonly emailService: EmailService) {}

  @SqsMessageHandler('email-queue', false)
  async handleMessage(message: Message) {
    const body = JSON.parse(message.Body!);
    this.logger.log(
      `Processing email job: ${message.MessageId} | type=${body.type}`,
    );
    await this.emailService.handleMessage(body, message.MessageId);
  }

  // Anything thrown above lands here and the message stays on the queue for
  // redelivery. sqs-consumer catches it before Nest's filters see it, so this
  // is the only place it can reach Sentry.
  @SqsConsumerEventHandler('email-queue', 'processing_error')
  onProcessingError(error: Error, message: Message) {
    this.logger.error(
      `Email processing error [${message.MessageId}]: ${error.message}`,
    );
    Sentry.captureException(error, {
      tags: { queue: 'email-queue' },
      extra: { messageId: message.MessageId },
    });
  }
}
