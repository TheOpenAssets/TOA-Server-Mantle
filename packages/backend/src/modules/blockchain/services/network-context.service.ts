import { Injectable } from '@nestjs/common';
import { AsyncLocalStorage } from 'async_hooks';
import { NetworkType } from '@openassets/types';

@Injectable()
export class NetworkContextService {
  private readonly als = new AsyncLocalStorage<NetworkType>();

  setNetwork(network: NetworkType) {
    this.als.enterWith(network);
  }

  getNetwork(): NetworkType {
    return this.als.getStore() || NetworkType.HASHKEY;
  }

  runWithNetwork<T>(network: NetworkType, fn: () => T): T {
    return this.als.run(network, fn);
  }
}
