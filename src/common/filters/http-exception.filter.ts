import {
    ArgumentsHost,
    Catch,
    ExceptionFilter,
    HttpException,
    HttpStatus,
    Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';

export interface ErrorResponse {
    statusCode: number;
    message: string | string[];
    error: string;
    path: string;
    timestamp: string;
}

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
    private readonly logger = new Logger(GlobalExceptionFilter.name);

    catch(exception: unknown, host: ArgumentsHost): void {
        const ctx = host.switchToHttp();
        const response = ctx.getResponse<Response>();
        const request = ctx.getRequest<Request>();

        const { status, message, error } = this.resolveException(exception);

        const body: ErrorResponse = {
        statusCode: status,
        message,
        error,
        path: request.url,
        timestamp: new Date().toISOString(),
        };

        if (status >= 500) {
        this.logger.error(
            `${request.method} ${request.url} → ${status}`,
            exception instanceof Error ? exception.stack : String(exception),
        );
        }

        response.status(status).json(body);
    }

    private resolveException(exception: unknown): {
        status: number;
        message: string | string[];
        error: string;
    } {
        if (exception instanceof HttpException) {
        const status = exception.getStatus();
        const res = exception.getResponse();
        const message =
            typeof res === 'object' && res !== null && 'message' in res
            ? (res as { message: string | string[] }).message
            : exception.message;
        const error =
            typeof res === 'object' && res !== null && 'error' in res
            ? (res as { error: string }).error
            : 'Error';
        return { status, message, error };
        }

        return {
        status: HttpStatus.INTERNAL_SERVER_ERROR,
        message: 'An unexpected error occurred',
        error: 'Internal Server Error',
        };
    }
}