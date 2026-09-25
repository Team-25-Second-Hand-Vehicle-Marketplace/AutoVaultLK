import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
} from '@nestjs/common';
import type { Response } from 'express';

/**
 * Catches every exception a controller/guard/strategy throws, including ones
 * that were never meant to be an HTTP response — a DB call inside
 * JwtStrategy.validate() throwing, say — and turns it into a JSON body
 * instead of whatever Nest's bare default renders. Without this, an
 * unexpected error anywhere in the request path (not just a deliberate
 * BadRequestException) surfaces to the client as a bodyless/differently-
 * shaped 500, which is what a dealer's browser was seeing as a plain
 * "Internal server error" with no indication of what actually happened.
 *
 * Mirrors auth-user-service's ProductionExceptionFilter (same shape, same
 * behavior) — duplicated rather than shared because each service is a
 * separate deployable with no common package between them, the same reason
 * csv-contract.ts and safe-local-path.ts are each copied per service.
 */
@Injectable()
@Catch()
export class ProductionExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(ProductionExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();

    const isProduction =
      process.env.NODE_ENV === 'production' ||
      process.env.DISABLE_VERBOSE_ERRORS === 'true';

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message: string | string[] = 'Internal server error';

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const exceptionResponse = exception.getResponse();

      if (typeof exceptionResponse === 'string') {
        message = exceptionResponse;
      } else if (
        typeof exceptionResponse === 'object' &&
        exceptionResponse !== null &&
        'message' in exceptionResponse
      ) {
        message = (exceptionResponse as { message: string | string[] }).message;
      }
    } else {
      // Not an HttpException at all — something threw a plain Error (or
      // worse) somewhere it wasn't expected to. Always worth a server-side
      // log regardless of environment, since the client only ever sees the
      // generic message below.
      this.logger.error(
        exception instanceof Error ? exception.stack ?? exception.message : String(exception),
      );
    }

    if (isProduction && status >= HttpStatus.INTERNAL_SERVER_ERROR) {
      message = 'Internal server error';
    }

    response.status(status).json({
      statusCode: status,
      message,
      ...(isProduction ? {} : { error: exception instanceof Error ? exception.name : 'Error' }),
    });
  }
}
