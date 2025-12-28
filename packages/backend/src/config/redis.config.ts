import { registerAs } from '@nestjs/config';

export default registerAs('redis', () => {
  const redisUrl = process.env.REDIS_URL;

  if (redisUrl) {
    const isTls = redisUrl.startsWith('rediss://');

    return {
      url: redisUrl,
      tls: isTls
        ? {
            rejectUnauthorized: false,
          }
        : undefined,
    };
  }

  // Local fallback
  return {
    host: process.env.REDIS_HOST || '127.0.0.1',
    port: parseInt(process.env.REDIS_PORT || '6379', 10),
    password: process.env.REDIS_PASSWORD,
  };
});
