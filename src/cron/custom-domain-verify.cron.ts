import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ConfigService } from '@nestjs/config';

/**
 * Keeps custom domains honest.
 *
 * Two things can silently invalidate a domain that was verified once: the
 * customer removes or repoints the CNAME, and the customer downgrades off a
 * plan that includes custom domains. Neither produces an event we could react
 * to, so both need a sweep.
 *
 * The sweep itself lives in ez-api (POST /domains/reverify) — this is only the
 * schedule. ez-api owns the plan catalog and is the sole writer of the
 * `customdomains` collection, so re-implementing the entitlement rules here
 * would mean a second copy of the tier table that rots the first time a plan's
 * limits change.
 *
 * Hourly is the deliberate cadence: a downgraded org keeps serving for at most
 * an hour, which is a fair trade against hammering DNS for every customer
 * domain. Everything urgent (cancellation, failed payment, chargeback) is
 * caught by ez-view on every request and does not wait for this.
 */
@Injectable()
export class CustomDomainVerifyCron {
  private readonly logger = new Logger(CustomDomainVerifyCron.name);

  constructor(private readonly config: ConfigService) {}

  @Cron(CronExpression.EVERY_HOUR)
  async sweep(): Promise<void> {
    const apiUrl = this.config.get<string>('apiUrl') || process.env.API_URL;
    const secret = process.env.CADDY_ASK_SECRET;

    // Not configured — no-op rather than a noisy failure every hour. The same
    // secret gates Caddy's ask endpoint, so an environment without it has no
    // working custom domains to sweep in the first place.
    if (!apiUrl || !secret) {
      this.logger.debug(
        'Skipping custom-domain sweep: API_URL or CADDY_ASK_SECRET not set',
      );
      return;
    }

    try {
      const res = await fetch(`${apiUrl.replace(/\/$/, '')}/domains/reverify`, {
        method: 'POST',
        headers: { 'x-caddy-secret': secret },
        signal: AbortSignal.timeout(60_000),
      });

      if (!res.ok) {
        this.logger.error(
          `Custom-domain sweep failed: ${res.status} ${res.statusText}`,
        );
        return;
      }

      const result = (await res.json()) as {
        checked: number;
        active: number;
        demoted: number;
        failed: number;
      };
      this.logger.log(
        `Custom-domain sweep: ${result.checked} checked, ${result.active} active, ${result.demoted} demoted, ${result.failed} failing`,
      );
    } catch (err) {
      this.logger.error(`Custom-domain sweep errored: ${err}`);
    }
  }
}
