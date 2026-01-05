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
    // Headers are already set in the controller
    const keepAliveInterval = setInterval(() => {
      try {
        res.write(': keep-alive\n\n');
      } catch (e) {
        // Connection might be closed
        clearInterval(keepAliveInterval);
      }
    }, 30000);

    const connection: SseConnection = { res, keepAliveInterval };

    if (!this.connections.has(walletAddress)) {
      this.connections.set(walletAddress, []);
    }
    const conns = this.connections.get(walletAddress);
    if (conns) conns.push(connection);

    this.logger.log(`SSE Connected: ${walletAddress} (Total: ${conns ? conns.length : 0})`);

    // Handle disconnect
    res.on('close', () => {
      clearInterval(keepAliveInterval);
      this.removeConnection(walletAddress, connection);
    });

    // Send initial connection confirmation
    this.sendToClient(res, 'connected', { connected: true, walletAddress });
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
    this.logger.log(`[SSE] Attempting to emit '${event}' to wallet: ${walletAddress}`);
    this.logger.log(`[SSE] Active connections: ${Array.from(this.connections.keys()).join(', ')}`);

    const userConns = this.connections.get(walletAddress);
    if (!userConns) {
      this.logger.warn(`[SSE] No active connection found for wallet: ${walletAddress}`);
      return; // User not connected, stored in DB anyway
    }

    this.logger.log(`[SSE] Found ${userConns.length} connection(s) for wallet: ${walletAddress}`);
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
    } catch (e: any) {
        this.logger.error(`Failed to send SSE: ${e.message}`);
    }
  }
}
