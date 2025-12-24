import { IsString, IsArray, IsObject, ValidateNested, IsOptional, IsNumber } from 'class-validator';
import { Type } from 'class-transformer';

class Field {
  @IsString()
  id!: string;

  @IsString()
  type!: string;
}

class Definition {
  @IsString()
  id!: string;

  @IsString()
  title!: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => Field)
  fields!: Field[];
}

class FieldRef {
  @IsString()
  id!: string;

  @IsString()
  type!: string;
}

class Answer {
  @ValidateNested()
  @Type(() => FieldRef)
  field!: FieldRef;

  @IsString()
  type!: string;

  @IsOptional()
  @IsString()
  text?: string;

  @IsOptional()
  @IsNumber()
  number?: number;

  @IsOptional()
  @IsString()
  date?: string;

  @IsOptional()
  @IsString()
  file_url?: string;
}

class FormResponse {
  @IsString()
  form_id!: string;

  @IsString()
  token!: string;

  @IsString()
  submitted_at!: string;

  @ValidateNested()
  @Type(() => Definition)
  definition!: Definition;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => Answer)
  answers!: Answer[];
}

export class TypeformWebhookDto {
  @IsString()
  event_id!: string;

  @IsString()
  event_type!: string;

  @ValidateNested()
  @Type(() => FormResponse)
  form_response!: FormResponse;
}
