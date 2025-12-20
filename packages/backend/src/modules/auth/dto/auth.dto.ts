import { IsString, IsNotEmpty } from 'class-validator';

export class ChallengeDto {
  @IsString()
  @IsNotEmpty()
  walletAddress!: string;
}

export class LoginDto {
  @IsString()
  @IsNotEmpty()
  walletAddress!: string;

  @IsString()
  @IsNotEmpty()
  signature!: string;

  @IsString()
  @IsNotEmpty()
  message!: string;
}

export class RefreshDto {
  @IsString()
  @IsNotEmpty()
  refreshToken!: string;
}
