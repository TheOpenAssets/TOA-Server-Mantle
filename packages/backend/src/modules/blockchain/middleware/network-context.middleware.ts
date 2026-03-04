import { Injectable, NestMiddleware, BadRequestException, ForbiddenException } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { ConfigService } from '@nestjs/config';
import { NetworkType } from '@openassets/types';
import { NetworkContextService } from '../services/network-context.service';

@Injectable()
export class NetworkContextMiddleware implements NestMiddleware {
  private enabledNetworks: NetworkType[] = [];

  constructor(
    private readonly networkContextService: NetworkContextService,
    private readonly configService: ConfigService,
  ) {
    const enabledStr = this.configService.get<string>('ENABLED_NETWORKS') || 
                      this.configService.get<string>('network.networkType') || 
                      'mantle';
    this.enabledNetworks = enabledStr.split(',').map(n => n.trim() as NetworkType);
  }

  use(req: Request, res: Response, next: NextFunction) {
    const networkHeader = req.header('X-Network')?.toLowerCase();
    
    let network: NetworkType = NetworkType.MANTLE;

    if (networkHeader) {
      if (Object.values(NetworkType).includes(networkHeader as NetworkType)) {
        network = networkHeader as NetworkType;
      } else {
        throw new BadRequestException(`Invalid X-Network header: ${networkHeader}`);
      }
    }

    if (!this.enabledNetworks.includes(network)) {
      throw new ForbiddenException(`Network ${network} is not enabled on this deployment`);
    }

    this.networkContextService.runWithNetwork(network, () => {
      // Add network to request object for easy access if needed
      (req as any).network = network;
      next();
    });
  }
}
