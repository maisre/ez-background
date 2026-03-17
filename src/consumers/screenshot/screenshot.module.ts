import { Module } from '@nestjs/common';
import { ScreenshotHandler } from './screenshot.handler.js';

@Module({
  providers: [ScreenshotHandler],
})
export class ScreenshotModule {}
