import { IsUUID } from 'class-validator';

export class CreateFavouriteDto {
  @IsUUID()
  buyerId: string;
}
