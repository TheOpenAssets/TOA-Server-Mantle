import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';
import * as bodyParser from 'body-parser';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // CORS – must be first
  app.enableCors({
    origin: [
      'https://toa-client-mantle.pages.dev',
      'http://localhost:5173',
      'http://localhost:3000',
    ],
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization','ngrok-skip-browser-warning'],
    credentials: true,
  });

  // CRITICAL FIX: Enable JSON body parsing globally
  app.use(bodyParser.json());
  app.use(bodyParser.urlencoded({ extended: true }));

  // Raw body ONLY for Typeform webhook (will override for this specific route)
  app.use(
    '/webhooks/typeform',
    bodyParser.json({
      verify: (req: any, _res, buf) => {
        req.rawBody = buf;
      },
    }),
  );

  // DEBUG: Log login requests AFTER body parsing

  // Global validation
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: false,  // Temporarily disabled for debugging
      transform: true,
    }),
  );

  const port = process.env.PORT || 3000;
  await app.listen(port, '0.0.0.0');
}

void bootstrap();
