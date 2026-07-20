import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { DatabaseModule } from '../../database/database.module.js';
import { ScreenshotHandler } from './screenshot.handler.js';
import { ScreenshotCron } from './screenshot.cron.js';
import { ScreenshotProducer } from './screenshot.producer.js';
import { ScreenshotService } from './screenshot.service.js';
import { screenshotProviders } from './screenshot.providers.js';

@Module({
  imports: [ConfigModule, DatabaseModule],
  providers: [
    ScreenshotHandler,
    ScreenshotCron,
    ScreenshotProducer,
    ScreenshotService,
    ...screenshotProviders,
  ],
})
export class ScreenshotModule {}
