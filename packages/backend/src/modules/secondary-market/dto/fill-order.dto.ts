import { IsString, IsNotEmpty, Matches } from 'class-validator';

export class FillOrderDto {
    @IsString()
    @IsNotEmpty()
    orderId!: string;

    @IsString()
    @IsNotEmpty()
    @Matches(/^\d+$/, { message: 'amountToFill must be a valid integer string' })
    amountToFill!: string; // Wei format (18 decimals)
}
