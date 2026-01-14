import { Injectable, Inject } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import Redis from 'ioredis';
import redisConfig from '../../config/redis.config';

@Injectable()
export class RedisService {
  private readonly client: Redis;

  constructor(
    @Inject(redisConfig.KEY)
    private config: ConfigType<typeof redisConfig>,
  ) {
    // Check if URL-based config is provided (production/cloud)
    if ('url' in this.config && this.config.url) {
      this.client = new Redis(this.config.url, {
        tls: this.config.tls,
        maxRetriesPerRequest: 3,
        retryStrategy: (times) => {
          if (times > 3) return null;
          return Math.min(times * 200, 2000);
        },
      });
    } else {
      // Fallback to host/port config (local development)
      this.client = new Redis({
        host: this.config.host,
        port: this.config.port,
        password: this.config.password,
        maxRetriesPerRequest: 3,
        retryStrategy: (times) => {
          if (times > 3) return null;
          return Math.min(times * 200, 2000);
        },
      });
    }

    this.client.on('error', (err) => {
      console.error('[RedisService] Connection error:', err.message);
    });
  }

  async set(key: string, value: string, ttl?: number): Promise<void> {
    if (ttl) {
      await this.client.set(key, value, 'EX', ttl);
    } else {
      await this.client.set(key, value);
    }
  }

  async get(key: string): Promise<string | null> {
    return this.client.get(key);
  }

  async del(key: string): Promise<void> {
    await this.client.del(key);
  }
}
