import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import * as express from 'express';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Raw body middleware for Typeform webhook (must come BEFORE global JSON parser)
  app.use('/webhooks/typeform', express.json({
    verify: (req: any, _res, buf) => {
      req.rawBody = buf.toString('utf8');
    }
  }));

  // Global JSON body parser for all other routes with increased limit
  app.use(express.json({ limit: '50mb' }));
  app.use(express.urlencoded({ limit: '50mb', extended: true }));

  app.enableCors({
  origin: [
    'https://toa-client-mantle.pages.dev',
    'http://localhost:5173',
    'http://localhost:3000',
  ],
  methods: '*',
  allowedHeaders: '*',
});

  await app.listen(3000);
}
void bootstrap();
