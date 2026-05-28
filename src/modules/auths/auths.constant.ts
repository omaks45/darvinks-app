import { BadRequestException } from '@nestjs/common';
import type { Request } from 'express';

export const MAX_PROFILE_PICTURE_BYTES = 5 * 1024 * 1024; // 5 MB
export const MAX_ATTENDANCE_PHOTO_BYTES = 10 * 1024 * 1024; // 10 MB

export const ALLOWED_IMAGE_MIMETYPES = ['image/jpeg', 'image/png', 'image/webp'];
export const ALLOWED_ATTENDANCE_MIMETYPES = ['image/jpeg', 'image/png'];

/**
 * Multer file filter for profile pictures — allows JPEG, PNG, WebP.
 * The Express.Multer.File type is provided by @types/multer which augments
 * the global Express namespace — no extra import needed when "multer" is
 * listed in tsconfig.json > compilerOptions > types.
 */
export function imageFileFilter(
    _req: Request,
    file: Express.Multer.File,
    callback: (error: Error | null, acceptFile: boolean) => void,
    ): void {
    if (!ALLOWED_IMAGE_MIMETYPES.includes(file.mimetype)) {
        callback(
        new BadRequestException(
            `Unsupported file type: ${file.mimetype}. Allowed: ${ALLOWED_IMAGE_MIMETYPES.join(', ')}`,
        ),
        false,
        );
        return;
    }
    callback(null, true);
}

/** Multer file filter for attendance photos — JPEG and PNG only. */
export function attendancePhotoFilter(
    _req: Request,
    file: Express.Multer.File,
    callback: (error: Error | null, acceptFile: boolean) => void,
    ): void {
    if (!ALLOWED_ATTENDANCE_MIMETYPES.includes(file.mimetype)) {
        callback(
        new BadRequestException('Attendance photos must be JPEG or PNG'),
        false,
        );
        return;
    }
    callback(null, true);
}