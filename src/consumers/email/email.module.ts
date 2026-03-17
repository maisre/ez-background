import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { DatabaseModule } from '../../database/database.module.js';
import { EmailHandler } from './email.handler.js';
import { EmailService } from './email.service.js';
import { emailProviders } from './email.providers.js';

@Module({
  imports: [ConfigModule, DatabaseModule],
  providers: [
    EmailHandler,
    EmailService,
    ...emailProviders,
    {
      provide: 'RESEND_API_KEY',
      useFactory: (configService: ConfigService) =>
        configService.get('RESEND_API_KEY'),
      inject: [ConfigService],
    },
  ],
})
export class EmailModule {}
