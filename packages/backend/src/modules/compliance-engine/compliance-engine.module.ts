import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AttestationService } from './services/attestation.service';

@Module({
  imports: [ConfigModule],
  providers: [AttestationService],
  exports: [AttestationService],
})
export class ComplianceEngineModule {}
