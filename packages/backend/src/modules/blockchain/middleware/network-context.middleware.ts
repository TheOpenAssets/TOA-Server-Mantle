import { Injectable, NestMiddleware, BadRequestException } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { NetworkType } from '@openassets/types';
import { NetworkContextService } from '../services/network-context.service';

@Injectable()
export class NetworkContextMiddleware implements NestMiddleware {
  constructor(private readonly networkContextService: NetworkContextService) {}

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

    this.networkContextService.runWithNetwork(network, () => {
      // Add network to request object for easy access if needed
      (req as any).network = network;
      next();
    });
  }
}
