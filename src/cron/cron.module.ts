import { Module } from '@nestjs/common';
import { SnippetCleanupCron } from './snippet-cleanup.cron.js';
import { UsageReportCron } from './usage-report.cron.js';

@Module({
  providers: [SnippetCleanupCron, UsageReportCron],
})
export class CronModule {}
