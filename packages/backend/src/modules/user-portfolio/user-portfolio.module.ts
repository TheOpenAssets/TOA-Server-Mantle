import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { UserPortfolio, UserPortfolioSchema } from './schemas/user-portfolio.schema';
import { UserPortfolioService } from './services/user-portfolio.service';
import { UserPortfolioController } from './controllers/user-portfolio.controller';
import { TrustlineController } from './controllers/trustline.controller';
import { Purchase, PurchaseSchema } from '../../database/schemas/purchase.schema';
import { Asset, AssetSchema } from '../../database/schemas/asset.schema';
import { Settlement, SettlementSchema } from '../../database/schemas/settlement.schema';
import { UserYieldClaim, UserYieldClaimSchema } from '../../database/schemas/user-yield-claim.schema';
import { LeveragePosition, LeveragePositionSchema } from '../../database/schemas/leverage-position.schema';
import { SolvencyPosition, SolvencyPositionSchema } from '../../database/schemas/solvency-position.schema';
import { TrustlineRequest, TrustlineRequestSchema } from '../../database/schemas/trustline-request.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: UserPortfolio.name, schema: UserPortfolioSchema },
      { name: Purchase.name, schema: PurchaseSchema },
      { name: Asset.name, schema: AssetSchema },
      { name: Settlement.name, schema: SettlementSchema },
      { name: UserYieldClaim.name, schema: UserYieldClaimSchema },
      { name: LeveragePosition.name, schema: LeveragePositionSchema },
      { name: SolvencyPosition.name, schema: SolvencyPositionSchema },
      { name: TrustlineRequest.name, schema: TrustlineRequestSchema },
    ]),
  ],
  controllers: [UserPortfolioController, TrustlineController],
  providers: [UserPortfolioService],
  exports: [UserPortfolioService],
})
export class UserPortfolioModule {}

