import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import * as express from 'express';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Raw body middleware for Typeform webhook
  app.use('/webhooks/typeform', express.json({
    verify: (req: any, res, buf) => {
      req.rawBody = buf.toString('utf8');
    }
  }));

  app.enableCors({
    origin: '*',
    credentials: true,
  });
  await app.listen(3000);
}
void bootstrap();
