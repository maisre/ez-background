import {
  Injectable,
  Logger,
  OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { chromium, Browser } from 'playwright';
import sharp from 'sharp';
import { ScreenshotTarget } from './screenshot.types.js';

// Renders an ez-view page in a headless browser and stores the image in the
// assets bucket, returning its public URL. The browser is launched lazily and
// reused across jobs (launch is the expensive part); it is torn down on
// shutdown.
@Injectable()
export class ScreenshotService implements OnModuleDestroy {
  private readonly logger = new Logger(ScreenshotService.name);
  private readonly s3: S3Client;
  private readonly bucket: string;
  private readonly cdnUrl: string;
  private readonly viewUrl: string;
  private readonly width: number;
  private readonly height: number;
  private readonly thumbWidth: number;
  private readonly webpQuality: number;
  private browser: Browser | null = null;
  private launching: Promise<Browser> | null = null;

  constructor(private readonly config: ConfigService) {
    const endpoint = config.get<string>('aws.endpoint', '');
    this.s3 = new S3Client({
      region: config.get<string>('aws.region', 'us-east-1'),
      // LocalStack needs path-style addressing (mirrors ez-api UploadsService).
      ...(endpoint ? { endpoint, forcePathStyle: true } : {}),
    });
    this.bucket = config.get<string>('aws.assets.bucket', 'ez-snippet-assets');
    this.cdnUrl = config.get<string>('aws.assets.cdnUrl', '');
    this.viewUrl = config.get<string>('screenshot.viewUrl', '');
    this.width = config.get<number>('screenshot.viewportWidth', 1280);
    this.height = config.get<number>('screenshot.viewportHeight', 800);
    this.thumbWidth = config.get<number>('screenshot.thumbWidth', 800);
    this.webpQuality = config.get<number>('screenshot.webpQuality', 80);
  }

  // Capture `${viewUrl}/view/<type>/<id>` and upload it. Returns the public URL
  // of the stored thumbnail. Keyed under the owning org so an org's assets
  // (uploads/<orgId>/ and thumbnails/<orgId>/) can be swept as one prefix.
  async capture(
    type: ScreenshotTarget,
    id: string,
    orgId: string,
  ): Promise<string> {
    const url = `${this.viewUrl}/view/${type}/${id}`;
    const browser = await this.getBrowser();
    const context = await browser.newContext({
      viewport: { width: this.width, height: this.height },
      // Capture at 1x: the shot is downscaled to thumbWidth anyway, so a 2x
      // capture would just be a bigger source thrown away. Rendering at desktop
      // width still gives the true desktop layout.
      deviceScaleFactor: 1,
    });

    try {
      const page = await context.newPage();
      const response = await page.goto(url, {
        waitUntil: 'networkidle',
        timeout: 30000,
      });
      if (response && !response.ok()) {
        throw new Error(`ez-view returned ${response.status()} for ${url}`);
      }

      // Viewport-only shot (not fullPage): dashboard cards show the top of the
      // page, and a full-page capture of a long marketing page makes a poor
      // thumbnail.
      const raw = await page.screenshot({ type: 'png', fullPage: false });

      // Downscale to a card-sized thumbnail and encode WebP. Turns a ~2-3 MB
      // full-res desktop PNG into a ~40 KB image sized for the ~260-400px card,
      // which also renders far cleaner than an 8x in-browser downscale.
      const thumb = await sharp(raw)
        .resize({ width: this.thumbWidth, withoutEnlargement: true })
        .webp({ quality: this.webpQuality })
        .toBuffer();

      const key = `thumbnails/${orgId}/${type}/${id}.webp`;
      await this.upload(key, thumb);
      this.logger.log(
        `Captured ${type} ${id} -> ${key} (${Math.round(thumb.length / 1024)} KB)`,
      );
      return this.assetUrl(key);
    } finally {
      await context.close();
    }
  }

  private async upload(key: string, body: Buffer): Promise<void> {
    await this.s3.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: body,
        ContentType: 'image/webp',
        // Not an org upload — no lifecycle=temp tag, so it is never swept by
        // the temp-expiry rule.
        CacheControl: 'public, max-age=60',
      }),
    );
  }

  private assetUrl(key: string): string {
    return this.cdnUrl ? `${this.cdnUrl}/${key}` : `s3://${this.bucket}/${key}`;
  }

  // Serialize concurrent first-callers onto a single browser launch.
  private async getBrowser(): Promise<Browser> {
    if (this.browser?.isConnected()) return this.browser;
    if (this.launching) return this.launching;
    this.launching = chromium
      .launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] })
      .then((b) => {
        this.browser = b;
        this.launching = null;
        return b;
      })
      .catch((err) => {
        this.launching = null;
        throw err;
      });
    return this.launching;
  }

  async onModuleDestroy(): Promise<void> {
    await this.browser?.close().catch(() => undefined);
  }
}
