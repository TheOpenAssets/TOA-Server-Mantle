import { ConsoleLogger, Injectable } from '@nestjs/common';

@Injectable()
export class ISTLogger extends ConsoleLogger {
  protected formatTimestamp(): string {
    const now = new Date();
    // IST is UTC+5:30
    const istTime = new Date(now.getTime() + (5.5 * 60 * 60 * 1000));
    return istTime.toISOString().replace('T', ' ').replace('Z', ' IST');
  }
}