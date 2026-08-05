import { Column, Entity, PrimaryColumn } from 'typeorm';

/**
 * Read-only projection of marketplace.vehicles, for the admin dashboard
 * (listing counts, moderation queue). admin_service_role holds SELECT
 * only — approving/rejecting a listing goes through marketplace-service's
 * API, never a direct write here.
 */
@Entity({ schema: 'marketplace', name: 'vehicles', synchronize: false })
export class VehicleView {
  @PrimaryColumn('uuid')
  id: string;

  @Column({ name: 'dealer_id', type: 'uuid' })
  dealerId: string;

  @Column({ type: 'varchar', length: 100 })
  make: string;

  @Column({ type: 'varchar', length: 100 })
  model: string;

  @Column({ type: 'varchar', length: 20 })
  status: string;

  @Column({
    type: 'numeric',
    precision: 14,
    scale: 2,
    transformer: {
      to: (v: number) => v,
      from: (v: string) => (v === null ? null : parseFloat(v)),
    },
  })
  price: number;

  @Column({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
