export default () => ({
  port: parseInt(process.env.PORT || '3002', 10),
  database: {
    url:
      process.env.DATABASE_URL ||
      'mongodb://root:root@127.0.0.1:27017/ez?authSource=admin',
  },
  aws: {
    region: process.env.AWS_REGION || 'us-east-1',
    sqs: {
      screenshotQueueUrl: process.env.SQS_SCREENSHOT_QUEUE_URL || '',
      emailQueueUrl: process.env.SQS_EMAIL_QUEUE_URL || '',
    },
  },
  RESEND_API_KEY: process.env.RESEND_API_KEY || '',
});
