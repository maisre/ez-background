import { Injectable, Logger } from '@nestjs/common';
import { SqsMessageHandler, SqsConsumerEventHandler } from '@ssut/nestjs-sqs';
import type { Message } from '@aws-sdk/client-sqs';
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
    await this.emailService.handleMessage(body);
  }

  @SqsConsumerEventHandler('email-queue', 'processing_error')
  onProcessingError(error: Error, message: Message) {
    this.logger.error(
      `Email processing error [${message.MessageId}]: ${error.message}`,
    );
  }
}
