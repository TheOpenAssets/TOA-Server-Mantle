import { Injectable, NestMiddleware, BadRequestException, ForbiddenException } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { ConfigService } from '@nestjs/config';
import { NetworkType } from '@openassets/types';
import { NetworkContextService } from '../services/network-context.service';

@Injectable()
export class NetworkContextMiddleware implements NestMiddleware {
  private enabledNetworks: NetworkType[];

  constructor(
    private readonly networkContextService: NetworkContextService,
    private readonly configService: ConfigService,
  ) {
    const enabledStr =
      this.configService.get<string>('ENABLED_NETWORKS') ||
      process.env.ENABLED_NETWORKS ||
      'mantle';
    this.enabledNetworks = enabledStr
      .split(',')
      .map(n => n.trim().toLowerCase() as NetworkType)
      .filter(n => Object.values(NetworkType).includes(n));
  }

  use(req: Request, res: Response, next: NextFunction) {
    const networkHeader = req.header('X-Network')?.toLowerCase();

    let network: NetworkType = NetworkType.MANTLE;

    if (networkHeader) {
      if (!Object.values(NetworkType).includes(networkHeader as NetworkType) || networkHeader === NetworkType.UNKNOWN) {
        throw new BadRequestException(
          `Invalid network '${networkHeader}'. Valid options: ${Object.values(NetworkType).filter(n => n !== NetworkType.UNKNOWN).join(', ')}`,
        );
      }
      if (!this.enabledNetworks.includes(networkHeader as NetworkType)) {
        throw new ForbiddenException(
          `Network '${networkHeader}' is not enabled on this deployment. Enabled: ${this.enabledNetworks.join(', ')}`,
        );
      }
      network = networkHeader as NetworkType;
    }

    this.networkContextService.runWithNetwork(network, () => {
      (req as any).network = network;
      next();
    });
  }
}
