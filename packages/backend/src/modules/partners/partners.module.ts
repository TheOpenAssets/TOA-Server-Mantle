import { Module, forwardRef } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { PartnerController } from './controllers/partner.controller';
import { PartnerAdminController } from './controllers/partner-admin.controller';
import { PartnerGatewayController } from './controllers/partner-gateway.controller';
import { PartnerService } from './services/partner.service';
import { PartnerLoanService } from './services/partner-loan.service';
import { PartnerGatewayService } from './services/partner-gateway.service';
import { Partner, PartnerSchema } from '../../database/schemas/partner.schema';
import { PartnerLoan, PartnerLoanSchema } from '../../database/schemas/partner-loan.schema';
import { PartnerApiLog, PartnerApiLogSchema } from '../../database/schemas/partner-api-log.schema';
import { SolvencyModule } from '../solvency/solvency.module';
import { BlockchainModule } from '../blockchain/blockchain.module';
import { CreditScoreModule } from '@/src/modules/credit-score/credit-score.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Partner.name, schema: PartnerSchema },
      { name: PartnerLoan.name, schema: PartnerLoanSchema },
      { name: PartnerApiLog.name, schema: PartnerApiLogSchema },
    ]),
    forwardRef(() => SolvencyModule), // Circular dependency with SolvencyModule
    forwardRef(() => BlockchainModule), // Circular dependency via BlockchainModule
    CreditScoreModule,
  ],
  controllers: [PartnerController, PartnerAdminController, PartnerGatewayController],
  providers: [PartnerService, PartnerLoanService, PartnerGatewayService],
  exports: [PartnerService, PartnerLoanService, PartnerGatewayService],
})
export class PartnersModule {}
