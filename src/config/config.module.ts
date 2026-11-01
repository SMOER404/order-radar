import { Global, Module } from '@nestjs/common';
import { loadEnv, Env } from './env';
import { loadFilters, Filters } from './filters';

export const ENV = Symbol('ENV');
export const FILTERS = Symbol('FILTERS');

@Global()
@Module({
  providers: [
    { provide: ENV, useFactory: (): Env => loadEnv() },
    { provide: FILTERS, useFactory: (env: Env): Filters => loadFilters(env.FILTERS_PATH), inject: [ENV] },
  ],
  exports: [ENV, FILTERS],
})
export class ConfigModule {}
