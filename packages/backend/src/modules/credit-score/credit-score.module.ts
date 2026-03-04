import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  SolvencyPosition,
  SolvencyPositionSchema,
} from '@/src/database/schemas/solvency-position.schema';
import { CreditScoreController } from '@/src/modules/credit-score/credit-score.controller';
import { CreditScoreService } from '@/src/modules/credit-score/credit-score.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: SolvencyPosition.name, schema: SolvencyPositionSchema },
    ]),
  ],
  controllers: [CreditScoreController],
  providers: [CreditScoreService],
  exports: [CreditScoreService],
})
export class CreditScoreModule {}
