import { IsOptional, IsString, IsInt, Min, Max, IsDateString, IsEnum } from 'class-validator';
import { Type } from 'class-transformer';

export class CommitQueryDto {
    @IsOptional()
    @IsString()
    repo?: string;

    @IsOptional()
    @IsString()
    branch?: string;

    @IsOptional()
    @IsString()
    author?: string;

    @IsOptional()
    @IsDateString()
    since?: string;

    @IsOptional()
    @IsDateString()
    until?: string;

    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    @Max(1000)
    limit?: number = 100;
}

export class PullRequestQueryDto {
    @IsOptional()
    @IsString()
    repo?: string;

    @IsOptional()
    @IsEnum(['open', 'closed', 'all'])
    state?: 'open' | 'closed' | 'all';

    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    @Max(1000)
    limit?: number = 100;
}

export class TimelineQueryDto {
    @IsOptional()
    @IsString()
    repo?: string;

    @IsOptional()
    @IsDateString()
    since?: string;

    @IsOptional()
    @IsDateString()
    until?: string;

    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    @Max(1000)
    limit?: number = 100;
}

export class OrganizationQueryDto {
    @IsOptional()
    @IsString()
    repo?: string;
}

export class MetricsQueryDto {
    @IsString()
    repo!: string;
}