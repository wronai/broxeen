/**
 * @module core/queryBus
 * @description Generic query bus for CQRS read-side operations.
 *
 * Complements CommandBus — queries return data, commands mutate state.
 * Integrates with existing GetMessagesQuery, GetSettingsQuery.
 */

import type { IQuery, IQueryBus, IQueryHandler } from "./plugin.types";

export type QueryMiddleware = (
  query: IQuery<unknown>,
  next: () => Promise<unknown>,
) => Promise<unknown>;

export class QueryBus implements IQueryBus {
  private handlers = new Map<string, IQueryHandler<IQuery<unknown>, unknown>>();
  private middlewares: QueryMiddleware[] = [];

  register<TQuery extends IQuery<TResult>, TResult>(
    queryType: string,
    handler: IQueryHandler<TQuery, TResult>,
  ): void {
    if (this.handlers.has(queryType)) {
      throw new Error(`Handler already registered for query "${queryType}".`);
    }
    this.handlers.set(
      queryType,
      handler as IQueryHandler<IQuery<unknown>, unknown>,
    );
  }

  unregister(queryType: string): void {
    this.handlers.delete(queryType);
  }

  use(middleware: QueryMiddleware): void {
    this.middlewares.push(middleware);
  }

  async dispatch<TResult>(query: IQuery<TResult>): Promise<TResult> {
    const handler = this.handlers.get(query.type);
    if (!handler) {
      throw new Error(
        `No handler registered for query "${query.type}". ` +
        `Available queries: ${Array.from(this.handlers.keys()).join(", ") || "none"}`,
      );
    }

    const execute = () => handler.execute(query) as Promise<TResult>;

    if (this.middlewares.length === 0) {
      return execute();
    }

    let index = 0;
    const chain = (): Promise<unknown> => {
      if (index < this.middlewares.length) {
        const mw = this.middlewares[index++];
        return mw(query, chain);
      }
      return execute();
    };

    return chain() as Promise<TResult>;
  }

  get registeredQueries(): string[] {
    return Array.from(this.handlers.keys());
  }
}

// ─── Built-in Query Types ───────────────────────────────────

export interface ListPluginsQuery extends IQuery<PluginInfo[]> {
  readonly type: "plugins:list";
}

export interface PluginInfo {
  readonly id: string;
  readonly name: string;
  readonly intents: readonly string[];
  readonly available: boolean;
  readonly streaming: boolean;
}

export interface GetPluginStatusQuery extends IQuery<PluginInfo | null> {
  readonly type: "plugins:status";
  readonly pluginId: string;
}

/** Caching middleware for queries */
export function cachingMiddleware(
  ttlMs: number,
): QueryMiddleware {
  const cache = new Map<string, { result: unknown; expires: number }>();

  return async (query, next) => {
    const key = JSON.stringify(query);
    const cached = cache.get(key);

    if (cached && cached.expires > Date.now()) {
      return cached.result;
    }

    const result = await next();
    cache.set(key, { result, expires: Date.now() + ttlMs });
    return result;
  };
}
