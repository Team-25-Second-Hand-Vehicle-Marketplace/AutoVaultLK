import { MigrationInterface, QueryRunner } from 'typeorm';

export class AuthUsers1735000002000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE auth.users (
        id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        email         varchar(255) NOT NULL UNIQUE,
        password_hash varchar(255) NOT NULL,
        name          varchar(255) NOT NULL,
        role          varchar(20)  NOT NULL DEFAULT 'BUYER'
                      CHECK (role IN ('BUYER','DEALER','ADMIN')),
        is_active     boolean      NOT NULL DEFAULT true,
        created_at    timestamptz  NOT NULL DEFAULT now(),
        updated_at    timestamptz  NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(`CREATE INDEX idx_users_email ON auth.users (email)`);
    await queryRunner.query(`CREATE INDEX idx_users_role  ON auth.users (role)`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE auth.users`);
  }
}
