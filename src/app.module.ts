import { Module } from '@nestjs/common';
import { ConfigModule } from './config/config.module';
import { PrismaModule } from './prisma/prisma.service';
import { SourcesModule } from './sources/sources.module';
import { BotModule } from './bot/bot.module';
import { LlmService } from './llm/llm.service';
import { PipelineService } from './pipeline/pipeline.service';

@Module({
  imports: [ConfigModule, PrismaModule, SourcesModule, BotModule],
  providers: [LlmService, PipelineService],
})
export class AppModule {}
