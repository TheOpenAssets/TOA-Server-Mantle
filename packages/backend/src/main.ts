import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';
import * as bodyParser from 'body-parser';
import { ISTLogger } from './logger/ist-logger.service';

async function bootstrap() {
  const app = await NestFactory.create(AppModule.forRoot(), {
    logger: new ISTLogger(),
  });

  // CORS – must be first
  app.enableCors({
    origin: [
      'https://toa-client-mantle.pages.dev',
      /^https:\/\/.*\.ngrok-free\.app$/,
      /^http:\/\/localhost:\d+$/,
      /^http:\/\/127\.0\.0\.1:\d+$/,
      /^http:\/\/10(?:\.\d{1,3}){3}:\d+$/,
      /^http:\/\/192\.168(?:\.\d{1,3}){2}:\d+$/,
      /^http:\/\/172\.(?:1[6-9]|2\d|3[0-1])(?:\.\d{1,3}){2}:\d+$/,
      'https://dev.toa-client-mantle.pages.dev',
      'https://www.openassets.xyz',
      'https://theopenassets.vercel.app',
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
      'x-network',
      'X-Network',
      'sec-ch-ua',
      'sec-ch-ua-mobile',
      'sec-ch-ua-platform',
      'Referer',
      'User-Agent',
      'Origin',
    ],
    exposedHeaders: [
      'Content-Type',
      'Cache-Control',
      'Connection',
      'X-Accel-Buffering',
      'x-network',
      'X-Network',
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
