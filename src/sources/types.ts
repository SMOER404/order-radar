import { Source } from '@prisma/client';

export interface RawOrder {
  source: Source;
  externalId: string;
  url: string;
  title: string;
  description: string;
  budgetRub?: number;
  budgetText?: string;
  author?: string;
  publishedAt?: Date;
}

export interface OrderSource {
  /** Ключ для SourceState и логов, например "fl" или "telegram:@channel" */
  readonly name: string;
  enabled(): boolean;
  fetch(): Promise<RawOrder[]>;
}
