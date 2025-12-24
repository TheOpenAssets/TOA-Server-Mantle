import { IsString, IsNotEmpty, IsOptional, IsEnum } from 'class-validator';
import { UserRole } from '../../../database/schemas/user.schema';

export class ChallengeDto {
  @IsString()
  @IsNotEmpty()
  walletAddress!: string;

  @IsOptional()
  @IsEnum(UserRole)
  role?: UserRole;
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
