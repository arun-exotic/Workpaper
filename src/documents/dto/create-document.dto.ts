import { ApiProperty } from '@nestjs/swagger';
import { IsString, MinLength } from 'class-validator';

export class CreateDocumentDto {
  @ApiProperty({
    example: 'Bank Statement',
    description: 'The required document type/name for this client.',
  })
  @IsString()
  @MinLength(2)
  name: string;
}
