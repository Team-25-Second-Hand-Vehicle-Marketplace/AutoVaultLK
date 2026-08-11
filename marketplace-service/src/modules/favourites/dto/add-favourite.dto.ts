import { IsInt } from 'class-validator';

export class AddFavouriteDto {
  @IsInt()
  vehicleId: number;
}