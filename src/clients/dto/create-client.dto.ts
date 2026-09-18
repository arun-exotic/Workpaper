import { ApiProperty } from '@nestjs/swagger';
import { IsString, MinLength } from 'class-validator';

export class CreateClientDto {
  @ApiProperty({ example: 'ABC Traders Pvt. Ltd.' })
  @IsString()
  @MinLength(2)
  name: string;
}
