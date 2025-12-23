import { Injectable, Logger } from '@nestjs/common';
import { Response } from 'express';

interface SseConnection {
  res: Response;
  keepAliveInterval: NodeJS.Timeout;
}

@Injectable()
export class SseEmitterService {
  private readonly logger = new Logger(SseEmitterService.name);
  // Map walletAddress -> Array of connections (multiple tabs support)
  private connections: Map<string, SseConnection[]> = new Map();

  addConnection(walletAddress: string, res: Response) {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    });

    const keepAliveInterval = setInterval(() => {
      res.write(': keep-alive\n\n');
    }, 30000);

    const connection: SseConnection = { res, keepAliveInterval };

    if (!this.connections.has(walletAddress)) {
      this.connections.set(walletAddress, []);
    }
    this.connections.get(walletAddress).push(connection);

    this.logger.log(`SSE Connected: ${walletAddress} (Total: ${this.connections.get(walletAddress).length})`);

    // Handle disconnect
    res.on('close', () => {
      clearInterval(keepAliveInterval);
      this.removeConnection(walletAddress, connection);
    });

    // Send initial connection confirmation
    this.sendToClient(res, 'connected', { connected: true });
  }

  private removeConnection(walletAddress: string, connection: SseConnection) {
    const userConns = this.connections.get(walletAddress);
    if (!userConns) return;

    const index = userConns.indexOf(connection);
    if (index > -1) {
      userConns.splice(index, 1);
    }

    if (userConns.length === 0) {
      this.connections.delete(walletAddress);
    }
    this.logger.log(`SSE Disconnected: ${walletAddress}`);
  }

  emitToUser(walletAddress: string, event: string, data: any) {
    const userConns = this.connections.get(walletAddress);
    if (!userConns) return; // User not connected, stored in DB anyway

    userConns.forEach(conn => {
      this.sendToClient(conn.res, event, data);
    });
  }

  emitToAll(event: string, data: any) {
    this.connections.forEach((conns) => {
      conns.forEach(conn => this.sendToClient(conn.res, event, data));
    });
  }

  private sendToClient(res: Response, event: string, data: any) {
    try {
        res.write(`event: ${event}\n`);
        res.write(`data: ${JSON.stringify(data)}\n\n`);
    } catch (e) {
        this.logger.error(`Failed to send SSE: ${e.message}`);
    }
  }
}
