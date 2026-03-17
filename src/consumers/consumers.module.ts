import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { SqsModule } from '@ssut/nestjs-sqs';
import { ScreenshotModule } from './screenshot/screenshot.module.js';
import { EmailModule } from './email/email.module.js';

@Module({
  imports: [
    SqsModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const consumers: Array<{
          name: string;
          queueUrl: string;
          region: string;
        }> = [];
        const emailUrl = config.get<string>('aws.sqs.emailQueueUrl', '');
        if (emailUrl) {
          consumers.push({
            name: 'email-queue',
            queueUrl: emailUrl,
            region: config.get<string>('aws.region', 'us-east-1'),
          });
        }
        const screenshotUrl = config.get<string>(
          'aws.sqs.screenshotQueueUrl',
          '',
        );
        if (screenshotUrl) {
          consumers.push({
            name: 'screenshot-queue',
            queueUrl: screenshotUrl,
            region: config.get<string>('aws.region', 'us-east-1'),
          });
        }
        return { consumers, producers: [] };
      },
    }),
    ScreenshotModule,
    EmailModule,
  ],
})
export class ConsumersModule {}
