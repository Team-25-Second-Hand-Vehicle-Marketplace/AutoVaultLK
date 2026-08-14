import { Global, Module } from '@nestjs/common';
import { CsrfGuard } from './csrf.guard';
import { RefreshTokenCookieService } from './refresh-token-cookie.service';

@Global()
@Module({
  providers: [RefreshTokenCookieService, CsrfGuard],
  exports: [RefreshTokenCookieService, CsrfGuard],
})
export class SecurityModule {}
