import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

@Schema({ timestamps: true, collection: 'git_metrics' })
export class GitMetrics extends Document {
  @Prop({ required: true, unique: true, index: true })
  repoName!: string;

  // 1. Data for GitHubCalendar component
  @Prop({ type: [{ date: String, count: Number }] })
  contributionData!: { date: string; count: number }[];

  // 2. Data for commit-graph library
  @Prop({ type: Object })
  graphData!: {
    commits: Array<{
      sha: string;
      commit: {
        author: { name: string; date: string; email?: string };
        message: string;
      };
      parents: Array<{ sha: string }>;
      html_url?: string;
    }>;
    branchHeads: Array<{
      name: string;
      commit: { sha: string };
      link?: string;
    }>;
  };

  // 3. Contributor Metadata
  @Prop({ type: [{ name: String, avatarUrl: String, profileUrl: String }] })
  contributors!: { name: string; avatarUrl: string; profileUrl: string }[];
}

export const GitMetricsSchema = SchemaFactory.createForClass(GitMetrics);
