import { IsString, IsNotEmpty, IsEthereumAddress } from 'class-validator';

export class RequestUsdcDto {
  @IsString()
  @IsNotEmpty()
  @IsEthereumAddress()
  receiverAddress!: string;
}
