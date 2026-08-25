import { ConfigService } from '@nestjs/config';

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

export function getAccessTokenVerifyOptions(configService: ConfigService) {
  return {
    secret: configService.getOrThrow<string>('JWT_ACCESS_SECRET'),
    issuer: getJwtIssuer(configService),
    audience: getJwtAudience(configService),
    algorithms: [getJwtAlgorithm(configService)],
  };
}
