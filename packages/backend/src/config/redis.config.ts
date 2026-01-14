import { registerAs } from '@nestjs/config';

export default registerAs('redis', () => {
  const redisUrl = process.env.REDIS_URL;

  // 1. If URL is provided (Cloud environments like Railway/Heroku/Render)
  if (redisUrl) {
    const isTls = redisUrl.startsWith('rediss://');
    return {
      url: redisUrl,
      // Ensure the driver knows to use TLS if the protocol is rediss://
      tls: isTls ? { rejectUnauthorized: false } : undefined,
      // Some drivers need the password explicitly even with a URL
      password: process.env.REDIS_PASSWORD || undefined,
    };
  }

  // 2. Local fallback (Docker or local machine)
  // Ensure host is 'redis' if running in docker-compose, not '127.0.0.1'
  return {
    host: process.env.REDIS_HOST || '127.0.0.1',
    port: parseInt(process.env.REDIS_PORT || '6379', 10),
    password: process.env.REDIS_PASSWORD || undefined,
    // Add a connection timeout to prevent the app from hanging
    connectTimeout: 10000,
  };
});