import { Injectable, NestMiddleware, BadRequestException, ForbiddenException } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { NetworkType } from '@openassets/types';
import { NetworkContextService } from '../services/network-context.service';
import { ChainManagerRegistry } from '../services/chain-manager-registry.service';

@Injectable()
export class NetworkContextMiddleware implements NestMiddleware {
  constructor(
    private readonly networkContextService: NetworkContextService,
    private readonly chainManagerRegistry: ChainManagerRegistry
  ) {}

  use(req: Request, res: Response, next: NextFunction) {
    const networkHeader = req.header('X-Network')?.toLowerCase();

    let network: NetworkType = NetworkType.MANTLE;

    if (networkHeader) {
      const validNetworks = Object.values(NetworkType).filter(n => n !== NetworkType.UNKNOWN);
      if (!validNetworks.includes(networkHeader as NetworkType)) {
        throw new BadRequestException(`Invalid network '${networkHeader}'. Valid networks: ${validNetworks.join(', ')}`);
      }

      const enabledNetworks = this.chainManagerRegistry.getEnabledNetworks();
      if (!enabledNetworks.includes(networkHeader as NetworkType)) {
        throw new ForbiddenException(`Network '${networkHeader}' is not enabled in this deployment`);
      }

      network = networkHeader as NetworkType;
    }

    this.networkContextService.runWithNetwork(network, () => {
      (req as any).network = network;
      next();
    });
  }
}
