import { IsString, IsBoolean, IsNotEmpty, Matches } from 'class-validator';

export class CreateOrderDto {
    @IsString()
    @IsNotEmpty()
    tokenAddress!: string;

    @IsString()
    @IsNotEmpty()
    @Matches(/^\d+$/, { message: 'amount must be a valid integer string' })
    amount!: string; // Wei format (18 decimals)

    @IsString()
    @IsNotEmpty()
    @Matches(/^\d+$/, { message: 'pricePerToken must be a valid integer string' })
    pricePerToken!: string; // USDC per token (6 decimals per 1e18 tokens)

    @IsBoolean()
    isBuy!: boolean; // true = Buy Order, false = Sell Order
}
