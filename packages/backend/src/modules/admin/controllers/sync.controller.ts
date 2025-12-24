import { Controller, Post, Body, UseGuards } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Asset, AssetDocument, AssetStatus } from '../../../database/schemas/asset.schema';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { AdminRoleGuard } from '../guards/admin-role.guard';

@Controller('admin/sync')
@UseGuards(JwtAuthGuard, AdminRoleGuard)
export class SyncController {
  constructor(
    @InjectModel(Asset.name) private assetModel: Model<AssetDocument>,
  ) {}

  @Post('update-status')
  async manuallyUpdateStatus(
    @Body('assetId') assetId: string,
    @Body('txHash') txHash: string,
    @Body('status') status: 'REGISTERED' | 'TOKENIZED',
    @Body('tokenAddress') tokenAddress?: string,
  ) {
    const update: any = {
      status,
    };

    if (status === 'REGISTERED') {
      update['registry.transactionHash'] = txHash;
      update['registry.registeredAt'] = new Date();
      update['checkpoints.registered'] = true;
    }

    if (status === 'TOKENIZED' && tokenAddress) {
      update['token.address'] = tokenAddress;
      update['token.deployedAt'] = new Date();
      update['token.transactionHash'] = txHash;
      update['checkpoints.tokenized'] = true;
    }

    await this.assetModel.updateOne({ assetId }, { $set: update });

    return {
      success: true,
      message: 'Asset status updated manually',
      assetId,
      status,
    };
  }
}
