import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { loadEnv } from '@trace/config';
import { AppModule } from './app.module';

const API_PREFIX = 'api/v1';

async function bootstrap(): Promise<void> {
  const env = loadEnv();
  const logger = new Logger('Main');

  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    cors: false,
    // Keep the exact request bytes on `req.rawBody` for billing-webhook
    // signature verification.
    rawBody: true,
  });

  // SCIM 2.0 clients send `application/scim+json`; parse it as JSON (RFC 7644).
  app.useBodyParser('json', { type: ['application/json', 'application/scim+json'] });

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

  // Hosts that assign the listen port at runtime (Render, Heroku, Railway, …)
  // export it as `PORT`; fall back to the configured API_PORT for local/dev.
  const port = Number(process.env.PORT) || env.API_PORT;
  await app.listen(port);
  logger.log(`TRACE API listening on http://localhost:${port}/${API_PREFIX}`);
  logger.log(`OpenAPI docs at http://localhost:${port}/${API_PREFIX}/docs`);
}

void bootstrap();
