import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { FaucetController } from './controllers/faucet.controller';
import { FaucetService } from './services/faucet.service';

@Module({
  imports: [ConfigModule],
  controllers: [FaucetController],
  providers: [FaucetService],
  exports: [FaucetService],
})
export class FaucetModule {}
