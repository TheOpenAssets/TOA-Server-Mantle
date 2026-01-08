import { Controller, Post, Body, HttpCode } from '@nestjs/common';
import { FaucetService } from '../services/faucet.service';
import { RequestUsdcDto } from '../dto/request-usdc.dto';
import { RequestMethDto } from '../dto/request-meth.dto';

@Controller('faucet')
export class FaucetController {
  constructor(private readonly faucetService: FaucetService) { }

  @Post('usdc')
  @HttpCode(200)
  async requestUsdc(@Body() dto: RequestUsdcDto) {
    const result = await this.faucetService.requestUsdc(dto.receiverAddress);

    return {
      success: true,
      message: `Successfully sent 1000 USDC to ${dto.receiverAddress}`,
      transactionHash: result.hash,
      amount: result.amount,
      receiverAddress: result.receiverAddress,
      explorerUrl: `https://sepolia.mantlescan.xyz/tx/${result.hash}`,
    };
  }

  @Post('meth')
  @HttpCode(200)
  async requestMeth(@Body() dto: RequestMethDto) {
    const result = await this.faucetService.requestMeth(dto.receiverAddress);

    return {
      success: true,
      message: `Successfully sent 10 mETH to ${dto.receiverAddress}`,
      transactionHash: result.hash,
      amount: result.amount,
      receiverAddress: result.receiverAddress,
      explorerUrl: `https://sepolia.mantlescan.xyz/tx/${result.hash}`,
    };
  }
}
