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
    this.client = new Redis({
      host: this.config.host,
      port: this.config.port,
      password: this.config.password,
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
