import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { User, UserDocument, UserRole } from '../../../database/schemas/user.schema';

@Injectable()
export class AdminService {
  constructor(
    @InjectModel(User.name) private userModel: Model<UserDocument>,
  ) {}

  async updateUserRole(walletAddress: string, role: UserRole) {
    const user = await this.userModel.findOne({ walletAddress });

    if (!user) {
      throw new NotFoundException(`User with wallet ${walletAddress} not found`);
    }

    await this.userModel.updateOne(
      { walletAddress },
      { $set: { role } },
    );

    return {
      message: `User role updated to ${role}`,
      walletAddress,
      role,
    };
  }
}
