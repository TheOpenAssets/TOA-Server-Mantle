import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Schema as MongooseSchema } from 'mongoose';

export enum GitActivityKind {
    REPOSITORY = 'REPOSITORY',
    BRANCH = 'BRANCH',
    COMMIT = 'COMMIT',
    PULL_REQUEST = 'PULL_REQUEST',
}

@Schema({
    timestamps: true,
    strict: false,
    collection: 'git_activities'
})
export class GitActivity {
    @Prop({
        type: String,
        enum: Object.values(GitActivityKind),
        required: true,
        index: true
    })
    kind!: GitActivityKind;

    @Prop({
        type: String,
        required: true,
        unique: true,
        index: true
    })
    platformId!: string;

    @Prop({
        type: String,
        required: true,
        index: true
    })
    repoName!: string;

    @Prop({
        type: String,
        index: true
    })
    branchName?: string;

    @Prop({
        type: String,
        index: true
    })
    author!: string;

    @Prop({
        type: Date,
        required: true,
        index: true
    })
    timestamp!: Date;

    @Prop({
        type: MongooseSchema.Types.Mixed,
        required: true
    })
    raw!: any;

    createdAt!: Date;
    updatedAt!: Date;
}

export const GitActivitySchema = SchemaFactory.createForClass(GitActivity);