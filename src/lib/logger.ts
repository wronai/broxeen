type LogLevel = "info" | "warn" | "error" | "debug";
type LogMethod = (message: string, ...args: any[]) => void;

const isDebug = import.meta.env.VITE_DEBUG === "true";

function normalizeLogArg(arg: any) {
  if (arg instanceof Error) {
    return {
      name: arg.name,
      message: arg.message,
      stack: arg.stack,
    };
  }

  return arg;
}

function safeStringify(value: any): string {
  try {
    return JSON.stringify(value);
  } catch {
    try {
      return String(value);
    } catch {
      return "[unserializable]";
    }
  }
}

function emit(level: LogLevel, scope: string | undefined, message: string, ...args: any[]) {
  if (level === "debug" && !isDebug) {
    return;
  }

  const timestamp = new Date().toISOString();
  const scopePrefix = scope ? `[${scope}] ` : "";
  const line = `[${timestamp}] [${level.toUpperCase()}] ${scopePrefix}${message}`;

  const normalizedArgs = args.map(normalizeLogArg);
  const printableArgs =
    level === "warn" || level === "error"
      ? normalizedArgs.map((a) => (typeof a === "object" ? safeStringify(a) : a))
      : normalizedArgs;

  if (level === "warn") {
    console.warn(line, ...printableArgs);
    return;
  }

  if (level === "error") {
    console.error(line, ...printableArgs);
    return;
  }

  console.log(line, ...printableArgs);
}

export function createScopedLogger(scope?: string) {
  const log = (level: LogLevel): LogMethod => (message, ...args) => {
    emit(level, scope, message, ...args);
  };

  return {
    info: log("info"),
    warn: log("warn"),
    error: log("error"),
    debug: log("debug"),
  };
}

type ScopedLogger = ReturnType<typeof createScopedLogger>;

export const logger = {
  ...createScopedLogger(),
  scope: (scope: string): ScopedLogger => createScopedLogger(scope),
};

export function logSyncDecorator<TArgs extends unknown[], TResult>(
  scope: string,
  operationName: string,
  fn: (...args: TArgs) => TResult,
): (...args: TArgs) => TResult {
  const scoped = logger.scope(scope);

  return (...args: TArgs): TResult => {
    const startedAt = Date.now();
    scoped.debug(`-> ${operationName}()`, { argsCount: args.length });

    try {
      const result = fn(...args);
      scoped.debug(`<- ${operationName}() done in ${Date.now() - startedAt}ms`);
      return result;
    } catch (error) {
      scoped.error(`x ${operationName}() failed`, error);
      throw error;
    }
  };
}

export function logAsyncDecorator<TArgs extends unknown[], TResult>(
  scope: string,
  operationName: string,
  fn: (...args: TArgs) => Promise<TResult>,
): (...args: TArgs) => Promise<TResult> {
  const scoped = logger.scope(scope);

  return async (...args: TArgs): Promise<TResult> => {
    const startedAt = Date.now();
    scoped.debug(`-> ${operationName}()`, { argsCount: args.length });

    try {
      const result = await fn(...args);
      scoped.debug(`<- ${operationName}() done in ${Date.now() - startedAt}ms`);
      return result;
    } catch (error) {
      scoped.error(`x ${operationName}() failed`, error);
      throw error;
    }
  };
}
