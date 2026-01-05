import { IsString, IsNotEmpty } from 'class-validator';

export class RejectPrivateAssetRequestDto {
  @IsString()
  @IsNotEmpty()
  rejectionReason!: string; // Admin's reason for rejecting the request
}
