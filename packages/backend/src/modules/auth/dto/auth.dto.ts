import { 
  IsString, 
  IsNotEmpty, 
  IsOptional, 
  IsEnum, 
  registerDecorator, 
  ValidationOptions, 
  ValidatorConstraint, 
  ValidatorConstraintInterface 
} from 'class-validator';
import { UserRole } from '@openassets/types';
import { detectNetworkType, NetworkType } from '../utils/wallet.util';

@ValidatorConstraint({ name: 'isWalletAddress', async: false })
export class IsWalletAddressConstraint implements ValidatorConstraintInterface {
  validate(address: any) {
    if (typeof address !== 'string') return false;
    return detectNetworkType(address) !== NetworkType.UNKNOWN;
  }

  defaultMessage() {
    return 'Invalid wallet address format. Must be an EVM address (0x...) or Stellar public key (G...).';
  }
}

export function IsWalletAddress(validationOptions?: ValidationOptions) {
  return function (object: Object, propertyName: string) {
    registerDecorator({
      target: object.constructor,
      propertyName: propertyName,
      options: validationOptions,
      constraints: [],
      validator: IsWalletAddressConstraint,
    });
  };
}

export class ChallengeDto {
  @IsWalletAddress()
  @IsNotEmpty()
  walletAddress!: string;

  @IsOptional()
  @IsEnum(UserRole)
  role?: UserRole;
}

export class LoginDto {
  @IsWalletAddress()
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
