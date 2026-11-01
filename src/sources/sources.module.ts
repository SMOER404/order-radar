import { Module } from '@nestjs/common';
import { FlSource } from './fl.source';
import { KworkSource } from './kwork.source';
import { TelegramSource } from './telegram.source';

export const ORDER_SOURCES = Symbol('ORDER_SOURCES');

@Module({
  providers: [
    FlSource,
    KworkSource,
    TelegramSource,
    { provide: ORDER_SOURCES, useFactory: (...s: unknown[]) => s, inject: [FlSource, KworkSource, TelegramSource] },
  ],
  exports: [ORDER_SOURCES, TelegramSource],
})
export class SourcesModule {}
