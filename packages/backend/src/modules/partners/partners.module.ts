import { Module, forwardRef } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { PartnerController } from './controllers/partner.controller';
import { PartnerAdminController } from './controllers/partner-admin.controller';
import { PartnerService } from './services/partner.service';
import { PartnerLoanService } from './services/partner-loan.service';
import { Partner, PartnerSchema } from '../../database/schemas/partner.schema';
import { PartnerLoan, PartnerLoanSchema } from '../../database/schemas/partner-loan.schema';
import { PartnerApiLog, PartnerApiLogSchema } from '../../database/schemas/partner-api-log.schema';
import { SolvencyModule } from '../solvency/solvency.module';
import { BlockchainModule } from '../blockchain/blockchain.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Partner.name, schema: PartnerSchema },
      { name: PartnerLoan.name, schema: PartnerLoanSchema },
      { name: PartnerApiLog.name, schema: PartnerApiLogSchema },
    ]),
    forwardRef(() => SolvencyModule), // Circular dependency with SolvencyModule
    forwardRef(() => BlockchainModule), // Circular dependency via BlockchainModule
  ],
  controllers: [PartnerController, PartnerAdminController],
  providers: [PartnerService, PartnerLoanService],
  exports: [PartnerService, PartnerLoanService],
})
export class PartnersModule {}
