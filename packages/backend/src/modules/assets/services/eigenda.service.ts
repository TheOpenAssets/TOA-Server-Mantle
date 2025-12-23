import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';

@Injectable()
export class EigenDAService {
  private readonly logger = new Logger(EigenDAService.name);
  private readonly disperserUrl = process.env.EIGENDA_DISPERSER_URL || 'https://disperser-holesky.eigenda.xyz';

  async disperse(blobData: Buffer): Promise<{ requestId: string }> {
    this.logger.log('Dispersing blob to EigenDA...');
    try {
      const response = await axios.post(
        `${this.disperserUrl}/disperse/blob`,
        {
            data: blobData.toString('base64'), // EigenDA expects base64 encoded data
        },
        {
          headers: { 'Content-Type': 'application/json' },
          timeout: 120000, // 2 minutes
        },
      );
      this.logger.log(`Blob dispersed. Request ID: ${response.data.request_id}`);
      return { requestId: response.data.request_id };
    } catch (error) {
      this.logger.error('Failed to disperse blob to EigenDA', error);
      throw error;
    }
  }

  async waitForConfirmation(requestId: string): Promise<string> {
    this.logger.log(`Waiting for EigenDA confirmation for Request ID: ${requestId}`);
    for (let i = 0; i < 24; i++) {
      // 2 minutes total (24 * 5s)
      try {
        const response = await axios.get(`${this.disperserUrl}/disperse/blob/status/${requestId}`);
        const status = response.data.status;

        if (status === 'CONFIRMED') {
            const blobHeader = response.data.info.blob_header;
            // EigenDA returns a commitment, we can use the commitment root as ID or the tx hash
            // For this implementation, we'll return the commitment root as the blobId
            this.logger.log('EigenDA blob confirmed.');
            return blobHeader.commitment.commitment; 
        } else if (status === 'FAILED') {
            throw new Error('EigenDA dispersion failed');
        }
      } catch (error) {
          this.logger.warn(`Error checking status: ${error.message}`);
      }

      await new Promise((resolve) => setTimeout(resolve, 5000));
    }

    throw new Error('EigenDA confirmation timeout');
  }
}
