// src/modules/auths/auths.service.spec.ts
import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  ConflictException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { getQueueToken } from '@nestjs/bull';
import * as bcrypt from 'bcryptjs';
import { AuthService } from './auths.service';
import { PrismaService } from '@common/prisma/prisma.service';
import { CloudinaryService } from '@modules/cloudinary/cloudinary.service';
import { TokenService } from '@modules/tokens/tokens.service';
import { MailService } from '@modules/email/email.service';
import type { RegisterDto } from './dto/register.dto';
import type { LoginDto } from './dto/auth.dto';

// ─── Mocks ────────────────────────────────────────────────────────────────────

const mockPrisma = {
  user: {
    findFirst: jest.fn(),
    findUnique: jest.fn(),
    findUniqueOrThrow: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    count: jest.fn(),
  },
  passwordResetOtp: {
    create: jest.fn(),
    findFirst: jest.fn(),
    update: jest.fn(),
    updateMany: jest.fn(),
  },
  refreshToken: {
    updateMany: jest.fn(),
  },
  $transaction: jest.fn(),
};

const mockTokenService = {
  signAccessToken: jest.fn(),
  createRefreshToken: jest.fn(),
  rotateRefreshToken: jest.fn(),
  revokeToken: jest.fn(),
  revokeAllForUser: jest.fn(),
};

const mockCloudinary = {
  uploadBuffer: jest.fn(),
};

const mockMail = {
  sendForgotPasswordEmail: jest.fn(),
};

const mockConfig = {
  get: jest.fn((key: string) => {
    const cfg: Record<string, unknown> = {
      bcryptRounds: 10,
      jwt: { accessExpiry: '12h' },
    };
    return cfg[key];
  }),
};

const mockQueue = { add: jest.fn() };

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const REGISTER_DTO: RegisterDto = {
  fullName: 'Chioma Okafor',
  email: 'chioma@darvinks.com',
  phone: '+2348012345678',
  password: 'SecurePass123!',
  role: 'SALES_REPRESENTATIVE' as any,
  team: 'BRIGHT' as any,
  state: 'lagos',
  dateOfBirth: '1995-06-15',
  annualTargets: { LOTION: 500 },
};

const LOGIN_DTO: LoginDto = {
  email: 'chioma@darvinks.com',
  password: 'SecurePass123!',
};

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('AuthService', () => {
  let service: AuthService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: PrismaService,     useValue: mockPrisma },
        { provide: TokenService,      useValue: mockTokenService },
        { provide: CloudinaryService, useValue: mockCloudinary },
        { provide: ConfigService,     useValue: mockConfig },
        { provide: MailService,       useValue: mockMail },
        { provide: getQueueToken('notifications'), useValue: mockQueue },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
    jest.resetAllMocks();

    // Restore config mock after resetAllMocks
    mockConfig.get.mockImplementation((key: string) => {
      const cfg: Record<string, unknown> = {
        bcryptRounds: 10,
        jwt: { accessExpiry: '12h' },
      };
      return cfg[key];
    });
  });

  // ── register ───────────────────────────────────────────────────────────────

  describe('register()', () => {
    it('creates a user and returns employeeRef on success', async () => {
      mockPrisma.user.findFirst.mockResolvedValue(null);
      mockPrisma.user.count.mockResolvedValue(5);
      mockPrisma.user.create.mockResolvedValue({
        id: 'new-user-id',
        employeeRef: 'Dar-00000006',
      });

      const result = await service.register(REGISTER_DTO);

      expect(result.userId).toBe('new-user-id');
      expect(result.employeeRef).toBe('Dar-00000006');
      expect(result.message).toContain('successful');
    });

    it('throws ConflictException when email already exists', async () => {
      mockPrisma.user.findFirst.mockResolvedValue({
        email: REGISTER_DTO.email,
        phone: 'different-phone',
      });

      await expect(service.register(REGISTER_DTO)).rejects.toThrow(ConflictException);
    });

    it('throws ConflictException when phone already exists', async () => {
      mockPrisma.user.findFirst.mockResolvedValue({
        email: 'different@email.com',
        phone: REGISTER_DTO.phone,
      });

      await expect(service.register(REGISTER_DTO)).rejects.toThrow(ConflictException);
    });

    it('hashes the password before persisting — never stores plain text', async () => {
      mockPrisma.user.findFirst.mockResolvedValue(null);
      mockPrisma.user.count.mockResolvedValue(0);
      mockPrisma.user.create.mockResolvedValue({ id: 'uid', employeeRef: 'Dar-00000001' });

      await service.register(REGISTER_DTO);

      const createCall = mockPrisma.user.create.mock.calls[0][0];
      const storedHash = createCall.data.passwordHash;

      expect(storedHash).not.toBe(REGISTER_DTO.password);
      expect(await bcrypt.compare(REGISTER_DTO.password, storedHash)).toBe(true);
    });

    it('auto-assigns region from state', async () => {
      mockPrisma.user.findFirst.mockResolvedValue(null);
      mockPrisma.user.count.mockResolvedValue(0);
      mockPrisma.user.create.mockResolvedValue({ id: 'uid', employeeRef: 'Dar-00000001' });

      await service.register({ ...REGISTER_DTO, state: 'enugu', team: 'BRIGHT' as any });

      const createCall = mockPrisma.user.create.mock.calls[0][0];
      expect(createCall.data.region).toBe('SE1');
    });

    it('uploads profile picture to Cloudinary when provided', async () => {
      mockPrisma.user.findFirst.mockResolvedValue(null);
      mockPrisma.user.count.mockResolvedValue(0);
      mockCloudinary.uploadBuffer.mockResolvedValue({
        secure_url: 'https://res.cloudinary.com/darvinks/photo.jpg',
      });
      mockPrisma.user.create.mockResolvedValue({ id: 'uid', employeeRef: 'Dar-00000001' });

      const mockFile = {
        buffer: Buffer.from('fake-image'),
        mimetype: 'image/jpeg',
      } as Express.Multer.File;

      await service.register(REGISTER_DTO, mockFile);

      expect(mockCloudinary.uploadBuffer).toHaveBeenCalledWith(
        mockFile.buffer,
        'profiles',
        expect.any(Object),
      );
    });

    it('queues ID card generation job after successful registration', async () => {
      mockPrisma.user.findFirst.mockResolvedValue(null);
      mockPrisma.user.count.mockResolvedValue(0);
      mockPrisma.user.create.mockResolvedValue({ id: 'new-user-id', employeeRef: 'Dar-00000001' });

      await service.register(REGISTER_DTO);

      expect(mockQueue.add).toHaveBeenCalledWith(
        'generate-id-card',
        { userId: 'new-user-id', roleLabel: 'Sales Representative' },
        expect.any(Object),
      );
    });

    it('registration succeeds without a profile picture', async () => {
      mockPrisma.user.findFirst.mockResolvedValue(null);
      mockPrisma.user.count.mockResolvedValue(0);
      mockPrisma.user.create.mockResolvedValue({ id: 'uid', employeeRef: 'Dar-00000001' });

      await expect(service.register(REGISTER_DTO, undefined)).resolves.not.toThrow();
      expect(mockCloudinary.uploadBuffer).not.toHaveBeenCalled();
    });
  });

  // ── login ──────────────────────────────────────────────────────────────────

  describe('login()', () => {
    async function makeHashedUser(
      password: string,
      overrides: Partial<{ isActive: boolean }> = {},
    ) {
      return {
        id: 'user-id',
        email: LOGIN_DTO.email,
        passwordHash: await bcrypt.hash(password, 10),
        tier: 'TIER2',
        team: 'BRIGHT',
        isActive: true,
        ...overrides,
      };
    }

    it('returns access and refresh tokens on valid credentials', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(await makeHashedUser(LOGIN_DTO.password));
      mockTokenService.signAccessToken.mockReturnValue('access-token');
      mockTokenService.createRefreshToken.mockResolvedValue('refresh-token');

      const result = await service.login(LOGIN_DTO);

      expect(result.accessToken).toBe('access-token');
      expect(result.refreshToken).toBe('refresh-token');
      expect(result.expiresIn).toBe('12h');
    });

    it('throws UnauthorizedException when user not found', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);
      await expect(service.login(LOGIN_DTO)).rejects.toThrow(UnauthorizedException);
    });

    it('throws UnauthorizedException when password is wrong', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(await makeHashedUser('correct-password'));
      await expect(
        service.login({ ...LOGIN_DTO, password: 'wrong-password' }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('throws UnauthorizedException when account is deactivated', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(
        await makeHashedUser(LOGIN_DTO.password, { isActive: false }),
      );
      await expect(service.login(LOGIN_DTO)).rejects.toThrow(UnauthorizedException);
    });

    it('does not call token service when credentials are invalid', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);
      await expect(service.login(LOGIN_DTO)).rejects.toThrow();
      expect(mockTokenService.signAccessToken).not.toHaveBeenCalled();
      expect(mockTokenService.createRefreshToken).not.toHaveBeenCalled();
    });
  });

  // ── refresh ────────────────────────────────────────────────────────────────

  describe('refresh()', () => {
    it('returns new token pair via TokenService', async () => {
      mockTokenService.rotateRefreshToken.mockResolvedValue({
        accessToken:  'new-access',
        refreshToken: 'new-refresh',
        payload: { sub: 'uid', email: 'e', tier: 'TIER1', team: 'BRIGHT' },
      });

      const result = await service.refresh('old-refresh-token');

      expect(result.accessToken).toBe('new-access');
      expect(result.refreshToken).toBe('new-refresh');
      expect(mockTokenService.rotateRefreshToken).toHaveBeenCalledWith('old-refresh-token');
    });

    it('propagates UnauthorizedException from TokenService', async () => {
      mockTokenService.rotateRefreshToken.mockRejectedValue(
        new UnauthorizedException('expired'),
      );
      await expect(service.refresh('bad-token')).rejects.toThrow(UnauthorizedException);
    });
  });

  // ── logout ─────────────────────────────────────────────────────────────────

  describe('logout()', () => {
    it('delegates revocation to TokenService', async () => {
      mockTokenService.revokeToken.mockResolvedValue(undefined);
      await service.logout('some-refresh-token');
      expect(mockTokenService.revokeToken).toHaveBeenCalledWith('some-refresh-token');
    });
  });

  // ── changePassword ─────────────────────────────────────────────────────────

  describe('changePassword()', () => {
    it('updates password hash and revokes all tokens on success', async () => {
      const oldHash = await bcrypt.hash('OldPass123!', 10);
      mockPrisma.user.findUniqueOrThrow.mockResolvedValue({ passwordHash: oldHash });
      mockPrisma.user.update.mockResolvedValue({});
      mockTokenService.revokeAllForUser.mockResolvedValue(undefined);

      await service.changePassword('user-id', 'OldPass123!', 'NewPass456!');

      expect(mockPrisma.user.update).toHaveBeenCalledTimes(1);
      expect(mockTokenService.revokeAllForUser).toHaveBeenCalledWith('user-id');

      const updateCall = mockPrisma.user.update.mock.calls[0][0];
      const newHash = updateCall.data.passwordHash;
      expect(newHash).not.toBe('OldPass123!');
      expect(await bcrypt.compare('NewPass456!', newHash)).toBe(true);
    });

    it('throws BadRequestException when current password is incorrect', async () => {
      const oldHash = await bcrypt.hash('OldPass123!', 10);
      mockPrisma.user.findUniqueOrThrow.mockResolvedValue({ passwordHash: oldHash });

      await expect(
        service.changePassword('user-id', 'WrongPassword', 'NewPass456!'),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException when new password equals current password', async () => {
      const password = 'SamePass123!';
      mockPrisma.user.findUniqueOrThrow.mockResolvedValue({
        passwordHash: await bcrypt.hash(password, 10),
      });

      await expect(
        service.changePassword('user-id', password, password),
      ).rejects.toThrow(BadRequestException);
    });

    it('does NOT call update or revokeAll when validation fails', async () => {
      mockPrisma.user.findUniqueOrThrow.mockResolvedValue({
        passwordHash: await bcrypt.hash('Correct123!', 10),
      });

      await expect(
        service.changePassword('user-id', 'WrongPass', 'NewPass'),
      ).rejects.toThrow();

      expect(mockPrisma.user.update).not.toHaveBeenCalled();
      expect(mockTokenService.revokeAllForUser).not.toHaveBeenCalled();
    });
  });

  // ── forgotPassword ─────────────────────────────────────────────────────────

  describe('forgotPassword()', () => {
    it('creates an OTP and sends email when user exists and is active', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'user-id',
        fullName: 'Chioma Okafor',
        isActive: true,
      });
      mockPrisma.passwordResetOtp.updateMany.mockResolvedValue({ count: 0 });
      mockPrisma.passwordResetOtp.create.mockResolvedValue({ id: 'otp-id' });

      await service.forgotPassword('chioma@darvinks.com');

      expect(mockPrisma.passwordResetOtp.updateMany).toHaveBeenCalledWith({
        where: { userId: 'user-id', isUsed: false },
        data:  { isUsed: true },
      });
      expect(mockPrisma.passwordResetOtp.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            userId:    'user-id',
            expiresAt: expect.any(Date),
          }),
        }),
      );
      // Email is fire-and-forget (void) — give it a tick to fire
      await new Promise(resolve => setImmediate(resolve));
      expect(mockMail.sendForgotPasswordEmail).toHaveBeenCalledWith(
        expect.objectContaining({
          to:       'chioma@darvinks.com',
          fullName: 'Chioma Okafor',
          otp:      expect.stringMatching(/^\d{6}$/),
        }),
      );
    });

    it('stores the OTP as a bcrypt hash — never plain text', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'user-id', fullName: 'Chioma', isActive: true,
      });
      mockPrisma.passwordResetOtp.updateMany.mockResolvedValue({ count: 0 });
      mockPrisma.passwordResetOtp.create.mockResolvedValue({ id: 'otp-id' });

      await service.forgotPassword('chioma@darvinks.com');

      const createCall = mockPrisma.passwordResetOtp.create.mock.calls[0][0];
      const storedHash = createCall.data.otpHash;

      // Must be a bcrypt hash, not a plain 6-digit string
      expect(storedHash).toMatch(/^\$2[ab]\$\d+\$/);
    });

    it('silently returns when user does not exist — no email sent', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);

      await expect(service.forgotPassword('ghost@darvinks.com')).resolves.toBeUndefined();
      expect(mockPrisma.passwordResetOtp.create).not.toHaveBeenCalled();
      expect(mockMail.sendForgotPasswordEmail).not.toHaveBeenCalled();
    });

    it('silently returns when user is deactivated — no email sent', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'user-id', fullName: 'Chioma', isActive: false,
      });

      await expect(service.forgotPassword('chioma@darvinks.com')).resolves.toBeUndefined();
      expect(mockPrisma.passwordResetOtp.create).not.toHaveBeenCalled();
    });

    it('invalidates previous unused OTPs before creating a new one', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'user-id', fullName: 'Chioma', isActive: true,
      });
      mockPrisma.passwordResetOtp.updateMany.mockResolvedValue({ count: 1 });
      mockPrisma.passwordResetOtp.create.mockResolvedValue({ id: 'otp-id' });

      await service.forgotPassword('chioma@darvinks.com');

      // updateMany (invalidate old) must be called BEFORE create (new OTP)
      const updateManyOrder = mockPrisma.passwordResetOtp.updateMany.mock.invocationCallOrder[0];
      const createOrder     = mockPrisma.passwordResetOtp.create.mock.invocationCallOrder[0];
      expect(updateManyOrder).toBeLessThan(createOrder);
    });
  });

  // ── verifyOtp ──────────────────────────────────────────────────────────────

  describe('verifyOtp()', () => {
    it('returns { valid: true } when OTP matches and is not expired', async () => {
      const otp     = '483921';
      const otpHash = await bcrypt.hash(otp, 10);

      mockPrisma.user.findUnique.mockResolvedValue({ id: 'user-id' });
      mockPrisma.passwordResetOtp.findFirst.mockResolvedValue({
        id:        'otp-id',
        otpHash,
        isUsed:    false,
        expiresAt: new Date(Date.now() + 10 * 60 * 1000), // 10 mins from now
      });

      const result = await service.verifyOtp('chioma@darvinks.com', otp);
      expect(result).toEqual({ valid: true });
    });

    it('returns { valid: false } when OTP is wrong', async () => {
      const otpHash = await bcrypt.hash('483921', 10);

      mockPrisma.user.findUnique.mockResolvedValue({ id: 'user-id' });
      mockPrisma.passwordResetOtp.findFirst.mockResolvedValue({
        id: 'otp-id', otpHash, isUsed: false,
        expiresAt: new Date(Date.now() + 10 * 60 * 1000),
      });

      const result = await service.verifyOtp('chioma@darvinks.com', '000000');
      expect(result).toEqual({ valid: false });
    });

    it('returns { valid: false } when no active OTP record exists', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({ id: 'user-id' });
      mockPrisma.passwordResetOtp.findFirst.mockResolvedValue(null);

      const result = await service.verifyOtp('chioma@darvinks.com', '483921');
      expect(result).toEqual({ valid: false });
    });

    it('returns { valid: false } when email does not exist', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);

      const result = await service.verifyOtp('ghost@darvinks.com', '483921');
      expect(result).toEqual({ valid: false });
    });
  });

  // ── resetPassword ──────────────────────────────────────────────────────────

  describe('resetPassword()', () => {
    async function setupValidReset(otp = '483921') {
      const otpHash = await bcrypt.hash(otp, 10);
      mockPrisma.user.findUnique.mockResolvedValue({ id: 'user-id' });
      mockPrisma.passwordResetOtp.findFirst.mockResolvedValue({
        id: 'otp-id', otpHash, isUsed: false,
        expiresAt: new Date(Date.now() + 10 * 60 * 1000),
      });
      mockPrisma.$transaction.mockImplementation(
        (ops: Promise<unknown>[]) => Promise.all(ops),
      );
      mockPrisma.passwordResetOtp.update.mockResolvedValue({});
      mockPrisma.user.update.mockResolvedValue({});
      mockPrisma.refreshToken.updateMany.mockResolvedValue({ count: 1 });
    }

    it('resets password and marks OTP as used', async () => {
      await setupValidReset();

      await service.resetPassword('chioma@darvinks.com', '483921', 'NewSecure456!');

      expect(mockPrisma.$transaction).toHaveBeenCalled();
      expect(mockPrisma.passwordResetOtp.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { isUsed: true } }),
      );
      expect(mockPrisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ mustChangePassword: false }),
        }),
      );
    });

    it('hashes the new password before saving', async () => {
      await setupValidReset();

      await service.resetPassword('chioma@darvinks.com', '483921', 'NewSecure456!');

      const updateCall  = mockPrisma.user.update.mock.calls[0][0];
      const newHash     = updateCall.data.passwordHash;
      expect(newHash).not.toBe('NewSecure456!');
      expect(await bcrypt.compare('NewSecure456!', newHash)).toBe(true);
    });

    it('revokes all refresh tokens after password reset', async () => {
      await setupValidReset();

      await service.resetPassword('chioma@darvinks.com', '483921', 'NewSecure456!');

      expect(mockPrisma.refreshToken.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId: 'user-id', isRevoked: false },
          data:  { isRevoked: true },
        }),
      );
    });

    it('throws BadRequestException when OTP is wrong', async () => {
      const otpHash = await bcrypt.hash('483921', 10);
      mockPrisma.user.findUnique.mockResolvedValue({ id: 'user-id' });
      mockPrisma.passwordResetOtp.findFirst.mockResolvedValue({
        id: 'otp-id', otpHash, isUsed: false,
        expiresAt: new Date(Date.now() + 10 * 60 * 1000),
      });

      await expect(
        service.resetPassword('chioma@darvinks.com', '000000', 'NewPass456!'),
      ).rejects.toThrow(BadRequestException);

      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    });

    it('throws BadRequestException when no active OTP exists', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({ id: 'user-id' });
      mockPrisma.passwordResetOtp.findFirst.mockResolvedValue(null);

      await expect(
        service.resetPassword('chioma@darvinks.com', '483921', 'NewPass456!'),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException when user does not exist', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);

      await expect(
        service.resetPassword('ghost@darvinks.com', '483921', 'NewPass456!'),
      ).rejects.toThrow(BadRequestException);
    });

    it('does not call $transaction when OTP validation fails', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({ id: 'user-id' });
      mockPrisma.passwordResetOtp.findFirst.mockResolvedValue(null);

      await expect(
        service.resetPassword('chioma@darvinks.com', '483921', 'NewPass456!'),
      ).rejects.toThrow();

      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    });
  });
});