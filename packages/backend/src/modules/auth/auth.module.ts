import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { MongooseModule } from '@nestjs/mongoose';
import { ConfigModule, ConfigService } from '@nestjs/config';

import { AuthService } from './services/auth.service';
import { SignatureService } from './services/signature.service';
import { AuthController } from './controllers/auth.controller';
import { JwtStrategy } from './strategies/jwt.strategy';
import { RedisModule } from '../redis/redis.module';
import { User, UserSchema } from '../../database/schemas/user.schema';
import { UserSession, UserSessionSchema } from '../../database/schemas/session.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: User.name, schema: UserSchema },
      { name: UserSession.name, schema: UserSessionSchema },
    ]),
    PassportModule,
    RedisModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      useFactory: async (configService: ConfigService) => ({
        secret: configService.get<string>('JWT_SECRET') || 'secret',
        signOptions: { expiresIn: '15m' }, // Default
      }),
      inject: [ConfigService],
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, SignatureService, JwtStrategy],
  exports: [AuthService],
})
export class AuthModule {}
