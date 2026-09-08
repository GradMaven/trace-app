import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { loadEnv } from '@trace/config';
import { AppModule } from './app.module';

const API_PREFIX = 'api/v1';

async function bootstrap(): Promise<void> {
  const env = loadEnv();
  const logger = new Logger('Main');

  const app = await NestFactory.create(AppModule, { cors: false });

  app.use(cookieParser());
  app.use(helmet());
  app.enableCors({ origin: env.WEB_ORIGIN, credentials: true });
  app.setGlobalPrefix(API_PREFIX);
  app.enableShutdownHooks();

  const openapi = new DocumentBuilder()
    .setTitle('TRACE API')
    .setDescription('Sustainability evidence & supply-chain intelligence — Phase 1 surface.')
    .setVersion('1.0')
    .build();
  SwaggerModule.setup(`${API_PREFIX}/docs`, app, SwaggerModule.createDocument(app, openapi), {
    jsonDocumentUrl: `${API_PREFIX}/openapi.json`,
  });

  await app.listen(env.API_PORT);
  logger.log(`TRACE API listening on http://localhost:${env.API_PORT}/${API_PREFIX}`);
  logger.log(`OpenAPI docs at http://localhost:${env.API_PORT}/${API_PREFIX}/docs`);
}

void bootstrap();
