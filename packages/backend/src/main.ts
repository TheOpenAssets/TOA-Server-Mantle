import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import * as express from 'express';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // ---- RAW BODY FOR TYPEFORM (MUST BE FIRST) ----
  app.use(
    '/webhooks/typeform',
    express.json({
      verify: (req: any, _res, buf) => {
        req.rawBody = buf.toString('utf8');
      },
    }),
  );

  // ---- GLOBAL BODY PARSERS ----
  app.use(express.json({ limit: '50mb' }));
  app.use(express.urlencoded({ limit: '50mb', extended: true }));

  // ---- CORRECT CORS CONFIG ----
  app.enableCors({
    origin: [
      'https://toa-client-mantle.pages.dev',
      'http://localhost:3000',
      'http://localhost:5173',
    ],
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'X-Requested-With',
      'Accept',
    ],
    credentials: true,
    preflightContinue: false,
    optionsSuccessStatus: 204,
  });

  // ---- IMPORTANT: EXPLICITLY HANDLE OPTIONS ----
  app.use((req, res, next) => {
    if (req.method === 'OPTIONS') {
      return res.sendStatus(204);
    }
    next();
  });

  await app.listen(3000);
}

void bootstrap();
