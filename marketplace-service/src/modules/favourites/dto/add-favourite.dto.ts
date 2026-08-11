import { IsUUID } from 'class-validator';

export class AddFavouriteDto {
  @IsUUID()
  vehicleId: string;
}
