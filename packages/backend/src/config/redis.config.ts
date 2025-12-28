import { registerAs } from '@nestjs/config';

export default registerAs('redis', () => {
  // Railway / Redis Cloud (TLS)
  if (process.env.REDIS_URL) {
    return {
      url: process.env.REDIS_URL,
      tls: {
        rejectUnauthorized: false,
      },
    };
  }

  // Local development (no TLS)
  return {
    host: process.env.REDIS_HOST || '127.0.0.1',
    port: parseInt(process.env.REDIS_PORT || '6379', 10),
    password: process.env.REDIS_PASSWORD,
  };
});
