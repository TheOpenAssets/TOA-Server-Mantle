import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';
import * as bodyParser from 'body-parser';
import { ISTLogger } from './logger/ist-logger.service';
import { kMaxLength } from 'buffer';

async function bootstrap() {
  const app = await NestFactory.create(AppModule.forRoot(), {
    logger: new ISTLogger(),
  });

  // CORS – must be first
  app.enableCors({
    origin: [
      'https://toa-client-mantle.pages.dev',
      'http://localhost:5173',
      'http://localhost:3000',
      'https://dev.toa-client-mantle.pages.dev',
      'https://www.openassets.xyz',
      "https://www.openassets.xyz/creditcoin",
      'https://openassets.xyz',
      'http://10.155.192.113:5173',
    ],
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'ngrok-skip-browser-warning',
      'Cache-Control',
      'Accept',
      'X-Requested-With',
      'x-network'
    ],
    exposedHeaders: [
      'Content-Type',
      'Cache-Control',
      'Connection',
      'X-Accel-Buffering',
      'x-network',
    ],
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

  const port = process.env.PORT || 3005;
  await app.listen(port, '0.0.0.0');
}

void bootstrap();
