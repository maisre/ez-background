import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';

@Injectable()
export class UsageReportCron {
  private readonly logger = new Logger(UsageReportCron.name);

  @Cron(CronExpression.EVERY_DAY_AT_6AM)
  async handleReport() {
    this.logger.log('Generating daily usage report...');
    // TODO: Implement usage report generation (e.g. aggregate stats, send summary email)
  }
}
