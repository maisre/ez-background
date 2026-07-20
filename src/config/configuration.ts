export default () => ({
  port: parseInt(process.env.PORT || '3002', 10),
  database: {
    url:
      process.env.DATABASE_URL ||
      'mongodb://root:root@127.0.0.1:27017/ez?authSource=admin',
  },
  aws: {
    region: process.env.AWS_REGION || 'us-east-1',
    // Only set when pointing at LocalStack (http://localhost:4566). The AWS SDK
    // reads AWS_ENDPOINT_URL natively for SQS, but S3 also needs path-style
    // addressing, so the screenshot uploader passes this through explicitly.
    endpoint: process.env.AWS_ENDPOINT_URL || '',
    sqs: {
      screenshotQueueUrl: process.env.SQS_SCREENSHOT_QUEUE_URL || '',
      emailQueueUrl: process.env.SQS_EMAIL_QUEUE_URL || '',
    },
    assets: {
      bucket: process.env.ASSETS_BUCKET || 'ez-snippet-assets',
      // Public base URL for rendered thumbnails. Falls back to an s3:// URI
      // when unset (mirrors ez-api UploadsService.assetUrl).
      cdnUrl: (process.env.ASSETS_CDN_URL || '').replace(/\/+$/, ''),
    },
  },
  screenshot: {
    // Where the worker points a headless browser to render a page. Locally this
    // is ez-view on :3100; in-cluster it's the ez-view Service URL.
    viewUrl: (process.env.VIEW_URL || 'http://localhost:3100').replace(
      /\/+$/,
      '',
    ),
    // Trailing-edge debounce: a doc must have been quiet this long since its
    // last content edit before we capture it.
    debounceMs: parseInt(process.env.SCREENSHOT_DEBOUNCE_MS || '240000', 10),
    // Lease: if a doc was enqueued but no screenshot landed within this window
    // (crashed render, lost message), the scanner re-enqueues it.
    leaseMs: parseInt(process.env.SCREENSHOT_LEASE_MS || '600000', 10),
    // Viewport the page is rendered at — a desktop width so the captured
    // layout is the real desktop site (16:10, matching the dashboard .thumb box).
    viewportWidth: parseInt(process.env.SCREENSHOT_WIDTH || '1280', 10),
    viewportHeight: parseInt(process.env.SCREENSHOT_HEIGHT || '800', 10),
    // The capture is downscaled to this width (preserving aspect) and encoded
    // as WebP before upload — the dashboard card is only ~260-400px wide, so a
    // full-res desktop screenshot is wasteful and downscales harshly in-browser.
    thumbWidth: parseInt(process.env.SCREENSHOT_THUMB_WIDTH || '800', 10),
    webpQuality: parseInt(process.env.SCREENSHOT_WEBP_QUALITY || '80', 10),
  },
  RESEND_API_KEY: process.env.RESEND_API_KEY || '',
});
