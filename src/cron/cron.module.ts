import { Module } from '@nestjs/common';
import { ShutterstockCleanupCron } from './shutterstock-cleanup.cron.js';

// Scheduled jobs. ScheduleModule is wired in app.module, and ConfigModule is
// global, so a @Cron provider added here runs without further setup.
@Module({
  providers: [ShutterstockCleanupCron],
})
export class CronModule {}
