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
      // Not an HttpException at all - something threw a plain Error (or
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
