import { IsString, IsNotEmpty, IsEthereumAddress } from 'class-validator';

export class RequestMethDto {
  @IsString()
  @IsNotEmpty()
  @IsEthereumAddress()
  receiverAddress!: string;
}
