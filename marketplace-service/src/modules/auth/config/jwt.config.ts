import { ConfigService } from '@nestjs/config';
import { JwtVerifyOptions } from '@nestjs/jwt';

export type JwtAlgorithm = 'HS256';

export type AccessTokenPayload = {
  sub: string;
  email: string;
  role: string;
};

export function getJwtIssuer(configService: ConfigService): string {
  return configService.getOrThrow<string>('JWT_ISSUER');
}

export function getJwtAudience(configService: ConfigService): string {
  return configService.getOrThrow<string>('JWT_AUDIENCE');
}

export function getJwtAlgorithm(configService: ConfigService): JwtAlgorithm {
  const algorithm = configService.get<JwtAlgorithm>('JWT_ALGORITHM', 'HS256');
  if (algorithm !== 'HS256') {
    throw new Error(`Unsupported JWT algorithm: ${algorithm}`);
  }
  return algorithm;
}

/** Same verify options as auth-user-service — admin validates locally (SAD 3.5.1). */
export function getAccessTokenVerifyOptions(
  configService: ConfigService,
): JwtVerifyOptions {
  return {
    secret: configService.getOrThrow<string>('JWT_ACCESS_SECRET'),
    issuer: getJwtIssuer(configService),
    audience: getJwtAudience(configService),
    algorithms: [getJwtAlgorithm(configService)],
  };
}
