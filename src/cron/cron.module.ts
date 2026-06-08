import { Module } from '@nestjs/common';

// Placeholder for future scheduled jobs. ScheduleModule is wired in app.module
// so a @Cron provider added here will run without further setup.
@Module({
  providers: [],
})
export class CronModule {}
