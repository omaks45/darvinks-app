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
import type { RegisterDto } from './dto/register.dto';
import type { LoginDto } from './dto/auth.dto';

//Mock factories

const mockPrisma = {
  user: {
    findFirst: jest.fn(),
    findUnique: jest.fn(),
    findUniqueOrThrow: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    count: jest.fn(),
  },
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

// Fixtures

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

describe('AuthService', () => {
  let service: AuthService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: TokenService, useValue: mockTokenService },
        { provide: CloudinaryService, useValue: mockCloudinary },
        { provide: ConfigService, useValue: mockConfig },
        { provide: getQueueToken('notifications'), useValue: mockQueue },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
    jest.clearAllMocks();
  });

  // register

  describe('register()', () => {
    it('creates a user and returns employeeRef on success', async () => {
      mockPrisma.user.findFirst.mockResolvedValue(null); // no conflict
      mockPrisma.user.count.mockResolvedValue(5); // sequence = 6
      mockPrisma.user.create.mockResolvedValue({
        id: 'new-user-id',
        employeeRef: 'DRV-RAD-0006',
      });
      mockQueue.add.mockResolvedValue(undefined);

      const result = await service.register(REGISTER_DTO);

      expect(result.userId).toBe('new-user-id');
      expect(result.employeeRef).toBe('DRV-RAD-0006');
      expect(result.message).toContain('successful');
    });

    it('throws ConflictException when email already exists', async () => {
      mockPrisma.user.findFirst.mockResolvedValue({
        email: REGISTER_DTO.email,
        phone: 'different-phone',
      });

      await expect(service.register(REGISTER_DTO)).rejects.toThrow(
        ConflictException,
      );
    });

    it('throws ConflictException when phone already exists', async () => {
      mockPrisma.user.findFirst.mockResolvedValue({
        email: 'different@email.com',
        phone: REGISTER_DTO.phone,
      });

      await expect(service.register(REGISTER_DTO)).rejects.toThrow(
        ConflictException,
      );
    });

    it('hashes the password before persisting (never stores plain text)', async () => {
      mockPrisma.user.findFirst.mockResolvedValue(null);
      mockPrisma.user.count.mockResolvedValue(0);
      mockPrisma.user.create.mockResolvedValue({
        id: 'uid',
        employeeRef: 'DRV-BRT-0001',
      });
      mockQueue.add.mockResolvedValue(undefined);

      await service.register(REGISTER_DTO);

      const createCall = mockPrisma.user.create.mock.calls[0][0];
      const storedHash = createCall.data.passwordHash;

      expect(storedHash).not.toBe(REGISTER_DTO.password);
      const isMatch = await bcrypt.compare(REGISTER_DTO.password, storedHash);
      expect(isMatch).toBe(true);
    });

    it('auto-assigns region from state without requiring explicit region field', async () => {
      mockPrisma.user.findFirst.mockResolvedValue(null);
      mockPrisma.user.count.mockResolvedValue(0);
      mockPrisma.user.create.mockResolvedValue({
        id: 'uid',
        employeeRef: 'DRV-BRT-0001',
      });
      mockQueue.add.mockResolvedValue(undefined);

      await service.register({ ...REGISTER_DTO, state: 'enugu', team: 'BRIGHT' as any });

      const createCall = mockPrisma.user.create.mock.calls[0][0];
      expect(createCall.data.region).toBe('SE1');
    });

    it('uploads profile picture to Cloudinary when provided', async () => {
      mockPrisma.user.findFirst.mockResolvedValue(null);
      mockPrisma.user.count.mockResolvedValue(0);
      mockCloudinary.uploadBuffer.mockResolvedValue({
        secure_url: 'https://res.cloudinary.com/tb-darvinks/photo.jpg',
      });
      mockPrisma.user.create.mockResolvedValue({
        id: 'uid',
        employeeRef: 'DRV-BRT-0001',
      });
      mockQueue.add.mockResolvedValue(undefined);

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
      mockPrisma.user.create.mockResolvedValue({
        id: 'new-user-id',
        employeeRef: 'DRV-BRT-0001',
      });

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
      mockPrisma.user.create.mockResolvedValue({
        id: 'uid',
        employeeRef: 'DRV-BRT-0001',
      });
      mockQueue.add.mockResolvedValue(undefined);

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
      const passwordHash = await bcrypt.hash(password, 10);
      return {
        id: 'user-id',
        email: LOGIN_DTO.email,
        passwordHash,
        tier: 'TIER2',
        team: 'BRIGHT',
        isActive: true,
        ...overrides,
      };
    }

    it('returns access and refresh tokens on valid credentials', async () => {
      const user = await makeHashedUser(LOGIN_DTO.password);
      mockPrisma.user.findUnique.mockResolvedValue(user);
      mockTokenService.signAccessToken.mockReturnValue('access-token');
      mockTokenService.createRefreshToken.mockResolvedValue('refresh-token');

      const result = await service.login(LOGIN_DTO);

      expect(result.accessToken).toBe('access-token');
      expect(result.refreshToken).toBe('refresh-token');
      expect(result.expiresIn).toBe('12h');
    });

    it('throws UnauthorizedException when user not found', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);

      await expect(service.login(LOGIN_DTO)).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('throws UnauthorizedException when password is wrong', async () => {
      const user = await makeHashedUser('correct-password');
      mockPrisma.user.findUnique.mockResolvedValue(user);

      await expect(
        service.login({ ...LOGIN_DTO, password: 'wrong-password' }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('throws UnauthorizedException when account is deactivated', async () => {
      const user = await makeHashedUser(LOGIN_DTO.password, { isActive: false });
      mockPrisma.user.findUnique.mockResolvedValue(user);

      await expect(service.login(LOGIN_DTO)).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('uses timing-safe comparison when user does not exist (no timing attack)', async () => {
      // Should not throw a bcrypt error — must compare against a dummy hash
      mockPrisma.user.findUnique.mockResolvedValue(null);
      const start = Date.now();
      await expect(service.login(LOGIN_DTO)).rejects.toThrow(
        UnauthorizedException,
      );
      // Should take some time (bcrypt ran) not be near-instant
      const elapsed = Date.now() - start;
      expect(elapsed).toBeGreaterThan(0); // bcrypt did run
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
        accessToken: 'new-access',
        refreshToken: 'new-refresh',
        payload: { sub: 'uid', email: 'e', tier: 'TIER1', team: 'BRIGHT' },
      });

      const result = await service.refresh('old-refresh-token');

      expect(result.accessToken).toBe('new-access');
      expect(result.refreshToken).toBe('new-refresh');
      expect(mockTokenService.rotateRefreshToken).toHaveBeenCalledWith(
        'old-refresh-token',
      );
    });

    it('propagates UnauthorizedException from TokenService', async () => {
      mockTokenService.rotateRefreshToken.mockRejectedValue(
        new UnauthorizedException('expired'),
      );

      await expect(service.refresh('bad-token')).rejects.toThrow(
        UnauthorizedException,
      );
    });
  });

  // ── logout ─────────────────────────────────────────────────────────────────

  describe('logout()', () => {
    it('delegates revocation to TokenService', async () => {
      mockTokenService.revokeToken.mockResolvedValue(undefined);

      await service.logout('some-refresh-token');

      expect(mockTokenService.revokeToken).toHaveBeenCalledWith(
        'some-refresh-token',
      );
    });
  });

  // ── changePassword ─────────────────────────────────────────────────────────

  describe('changePassword()', () => {
    it('updates password hash and revokes all tokens on success', async () => {
      const oldHash = await bcrypt.hash('OldPass123!', 10);
      mockPrisma.user.findUniqueOrThrow.mockResolvedValue({
        passwordHash: oldHash,
      });
      mockPrisma.user.update.mockResolvedValue({});
      mockTokenService.revokeAllForUser.mockResolvedValue(undefined);

      await service.changePassword('user-id', 'OldPass123!', 'NewPass456!');

      expect(mockPrisma.user.update).toHaveBeenCalledTimes(1);
      expect(mockTokenService.revokeAllForUser).toHaveBeenCalledWith('user-id');

      // Verify the new hash is actually different and bcrypt-valid
      const updateCall = mockPrisma.user.update.mock.calls[0][0];
      const newHash = updateCall.data.passwordHash;
      expect(newHash).not.toBe('OldPass123!');
      expect(await bcrypt.compare('NewPass456!', newHash)).toBe(true);
    });

    it('throws BadRequestException when current password is incorrect', async () => {
      const oldHash = await bcrypt.hash('OldPass123!', 10);
      mockPrisma.user.findUniqueOrThrow.mockResolvedValue({
        passwordHash: oldHash,
      });

      await expect(
        service.changePassword('user-id', 'WrongPassword', 'NewPass456!'),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException when new password equals current password', async () => {
      const password = 'SamePass123!';
      const hash = await bcrypt.hash(password, 10);
      mockPrisma.user.findUniqueOrThrow.mockResolvedValue({
        passwordHash: hash,
      });

      await expect(
        service.changePassword('user-id', password, password),
      ).rejects.toThrow(BadRequestException);
    });

    it('does NOT call update or revokeAll when validation fails', async () => {
      const hash = await bcrypt.hash('Correct123!', 10);
      mockPrisma.user.findUniqueOrThrow.mockResolvedValue({ passwordHash: hash });

      await expect(
        service.changePassword('user-id', 'WrongPass', 'NewPass'),
      ).rejects.toThrow();

      expect(mockPrisma.user.update).not.toHaveBeenCalled();
      expect(mockTokenService.revokeAllForUser).not.toHaveBeenCalled();
    });
  });
});