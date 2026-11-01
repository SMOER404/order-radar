import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { AppModule } from './app.module';

// воркер не должен падать из-за одиночного сетевого сбоя где-то в библиотеке
process.on('unhandledRejection', (e) => Logger.error(`unhandledRejection: ${String(e)}`, 'Process'));

async function bootstrap() {
  // HTTP-сервер не нужен: приложение-воркер
  const app = await NestFactory.createApplicationContext(AppModule);
  app.enableShutdownHooks();
  Logger.log('order-radar запущен', 'Bootstrap');
}
bootstrap().catch((e) => {
  console.error(e);
  process.exit(1);
});
