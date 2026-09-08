import { Global, Module } from '@nestjs/common';
import { loadEnv } from '@trace/config';
import { createAIProvider, type AIProvider } from '@trace/ai';
import { AiJobsController } from './ai-jobs.controller';

export const AI_PROVIDER = Symbol('AI_PROVIDER');

@Global()
@Module({
  controllers: [AiJobsController],
  providers: [
    {
      provide: AI_PROVIDER,
      useFactory: (): AIProvider => {
        const env = loadEnv();
        return createAIProvider({
          mode: env.AI_PROVIDER,
          anthropicApiKey: env.ANTHROPIC_API_KEY || undefined,
          extractionModel: env.AI_MODEL_EXTRACTION,
          classificationModel: env.AI_MODEL_CLASSIFICATION,
        });
      },
    },
  ],
  exports: [AI_PROVIDER],
})
export class AiModule {}
