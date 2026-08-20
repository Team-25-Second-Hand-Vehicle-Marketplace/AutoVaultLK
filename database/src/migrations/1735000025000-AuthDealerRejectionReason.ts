import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds auth.dealer_profiles.rejection_reason — FR-09.
 *
 * FR-09 requires a rejection to trigger an email notifying the dealer of the
 * decision. Sending the reason only in that email leaves no record: the dealer
 * cannot see it again after deleting the mail, support cannot answer "why was
 * I rejected", and FR-02.2's accountability trail records who decided but not
 * on what grounds.
 *
 * Nullable because existing rejections predate this column, and because an
 * administrator may still reject without giving a reason.
 */
export class AuthDealerRejectionReason1735000025000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE auth.dealer_profiles
        ADD COLUMN rejection_reason varchar(500)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE auth.dealer_profiles
        DROP COLUMN rejection_reason
    `);
  }
}
