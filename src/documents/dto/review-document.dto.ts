import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsString, MinLength, ValidateIf } from 'class-validator';

export enum ReviewAction {
  APPROVE = 'APPROVE',
  REQUEST_CORRECTION = 'REQUEST_CORRECTION',
}

export class ReviewDocumentDto {
  @ApiProperty({ enum: ReviewAction })
  @IsEnum(ReviewAction)
  action: ReviewAction;

  @ApiProperty({
    required: false,
    example: 'Page 3 is missing. Please upload the complete bank statement.',
    description: 'Required when action is REQUEST_CORRECTION.',
  })
  @ValidateIf(
    (dto: ReviewDocumentDto) => dto.action === ReviewAction.REQUEST_CORRECTION,
  )
  @IsString()
  @MinLength(3, { message: 'A comment explaining the correction is required' })
  comment?: string;
}
