import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ConfigService } from '@nestjs/config';

// Reaps the on-demand Shutterstock Collections that ez-api creates for the
// "license all images" hand-off.
//
// Nothing about those collections is stored in our database — by design, so
// there is no per-collection bookkeeping to keep in sync. Cleanup is therefore
// purely time-based: ez-api names every collection it creates
// "[ezgen YYYY-MM-DD] <subject>" (see ShutterstockService.collectionName), and
// this cron parses that embedded date and deletes any older than the TTL.
//
// The name marker does double duty: it is also the guarantee that we only ever
// delete collections *we* generated. A human-curated collection in the same
// account won't match the marker, so it is never touched.
const NAME_MARKER = /^\[ezgen (\d{4}-\d{2}-\d{2})\]/;
const PER_PAGE = 100;
const MAX_PAGES = 50; // safety cap: never page forever (≤ 5000 collections)
const API_TIMEOUT_MS = 10_000;

@Injectable()
export class ShutterstockCleanupCron {
  private readonly logger = new Logger(ShutterstockCleanupCron.name);

  constructor(private readonly config: ConfigService) {}

  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async reap(): Promise<void> {
    const token = this.config.get<string>('shutterstock.apiToken');
    const enabled = this.config.get<boolean>('shutterstock.collectionsEnabled');
    if (!enabled || !token) return; // Not configured — no-op.

    const baseUrl = this.config.get<string>('shutterstock.baseUrl')!;
    const ttlDays = this.config.get<number>(
      'shutterstock.collectionTtlDays',
      30,
    );
    const cutoff = new Date(Date.now() - ttlDays * 24 * 60 * 60 * 1000);

    // Collect all stale ids first (listing is stable), then delete — deleting
    // while paginating would shift the pages under us.
    const stale: string[] = [];
    try {
      for (let page = 1; page <= MAX_PAGES; page++) {
        const res = await this.api(
          baseUrl,
          token,
          'GET',
          `/images/collections?per_page=${PER_PAGE}&page=${page}`,
        );
        const data: any[] = res?.data || [];
        if (!data.length) break;
        for (const c of data) {
          const match = NAME_MARKER.exec(c.name || '');
          if (!match) continue;
          const created = new Date(`${match[1]}T00:00:00Z`);
          if (created < cutoff) stale.push(c.id);
        }
        if (data.length < PER_PAGE) break;
      }
    } catch (err) {
      this.logger.error(`Failed to list collections: ${String(err)}`);
      return;
    }

    let deleted = 0;
    for (const id of stale) {
      try {
        await this.api(baseUrl, token, 'DELETE', `/images/collections/${id}`);
        deleted++;
      } catch (err) {
        // Leave it; the next daily run retries.
        this.logger.error(`Failed to delete collection ${id}: ${String(err)}`);
      }
    }
    if (deleted > 0) {
      this.logger.log(
        `Reaped ${deleted} expired Shutterstock collection(s) (older than ${ttlDays}d)`,
      );
    }
  }

  private async api(
    baseUrl: string,
    token: string,
    method: 'GET' | 'DELETE',
    path: string,
  ): Promise<any> {
    const response = await fetch(`${baseUrl}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
        'User-Agent': 'ez-snippet/1.0',
      },
      signal: AbortSignal.timeout(API_TIMEOUT_MS),
    });
    if (!response.ok) {
      throw new Error(`Shutterstock API ${method} ${path} → ${response.status}`);
    }
    const text = await response.text();
    return text ? JSON.parse(text) : {};
  }
}
