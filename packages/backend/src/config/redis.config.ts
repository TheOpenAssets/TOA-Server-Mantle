import { registerAs } from '@nestjs/config';

export default registerAs('redis', () => {
  // Railway / production (preferred)
  if (process.env.REDIS_URL) {
    return {
      url: process.env.REDIS_URL,
    };
  }

  // Local development fallback
  return {
    host: process.env.REDIS_HOST || '127.0.0.1',
    port: parseInt(process.env.REDIS_PORT || '6379', 10),
    password: process.env.REDIS_PASSWORD,
  };
});
