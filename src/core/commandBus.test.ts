import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  CommandBus,
  loggingMiddleware,
  createPluginQueryCommand,
} from "./commandBus";
import type { ICommand, ICommandHandler } from "./plugin.types";

// ── Test Commands ───────────────────────────────────────────

interface TestCommand extends ICommand<string> {
  type: "test:action";
  value: string;
}

interface VoidCommand extends ICommand<void> {
  type: "test:void";
}

describe("CommandBus", () => {
  let bus: CommandBus;

  beforeEach(() => {
    bus = new CommandBus();
  });

  describe("register / dispatch", () => {
    it("dispatches command to registered handler", async () => {
      const handler: ICommandHandler<TestCommand, string> = {
        execute: vi.fn().mockResolvedValue("result-42"),
      };

      bus.register("test:action", handler);

      const result = await bus.dispatch<string>({
        type: "test:action",
        value: "42",
      } as TestCommand);

      expect(result).toBe("result-42");
      expect(handler.execute).toHaveBeenCalledWith(
        expect.objectContaining({ type: "test:action", value: "42" }),
      );
    });

    it("throws on duplicate handler registration", () => {
      const handler: ICommandHandler<TestCommand, string> = {
        execute: vi.fn().mockResolvedValue("ok"),
      };

      bus.register("test:action", handler);
      expect(() => bus.register("test:action", handler)).toThrow(
        "already registered",
      );
    });

    it("throws when no handler found", async () => {
      await expect(
        bus.dispatch({ type: "unknown:command" }),
      ).rejects.toThrow("No handler registered");
    });

    it("unregister removes handler", async () => {
      const handler: ICommandHandler<VoidCommand, void> = {
        execute: vi.fn().mockResolvedValue(undefined),
      };

      bus.register("test:void", handler);
      bus.unregister("test:void");

      await expect(bus.dispatch({ type: "test:void" })).rejects.toThrow();
    });
  });

  describe("middleware", () => {
    it("middleware wraps handler execution", async () => {
      const order: string[] = [];

      const handler: ICommandHandler<VoidCommand, void> = {
        execute: vi.fn(async () => {
          order.push("handler");
        }),
      };

      bus.register("test:void", handler);

      bus.use(async (_cmd, next) => {
        order.push("before");
        const result = await next();
        order.push("after");
        return result;
      });

      await bus.dispatch({ type: "test:void" } as VoidCommand);

      expect(order).toEqual(["before", "handler", "after"]);
    });

    it("multiple middlewares chain correctly", async () => {
      const order: string[] = [];

      const handler: ICommandHandler<VoidCommand, void> = {
        execute: vi.fn(async () => {
          order.push("handler");
        }),
      };

      bus.register("test:void", handler);

      bus.use(async (_cmd, next) => {
        order.push("mw1-before");
        const r = await next();
        order.push("mw1-after");
        return r;
      });

      bus.use(async (_cmd, next) => {
        order.push("mw2-before");
        const r = await next();
        order.push("mw2-after");
        return r;
      });

      await bus.dispatch({ type: "test:void" } as VoidCommand);

      expect(order).toEqual([
        "mw1-before",
        "mw2-before",
        "handler",
        "mw2-after",
        "mw1-after",
      ]);
    });

    it("loggingMiddleware logs command lifecycle", async () => {
      const logs: string[] = [];
      const handler: ICommandHandler<VoidCommand, void> = {
        execute: vi.fn().mockResolvedValue(undefined),
      };

      bus.register("test:void", handler);
      bus.use(loggingMiddleware((msg) => logs.push(msg)));

      await bus.dispatch({ type: "test:void" } as VoidCommand);

      expect(logs).toHaveLength(2);
      expect(logs[0]).toContain("→ test:void");
      expect(logs[1]).toContain("✓ test:void");
    });

    it("loggingMiddleware logs errors", async () => {
      const logs: string[] = [];
      const handler: ICommandHandler<VoidCommand, void> = {
        execute: vi.fn().mockRejectedValue(new Error("boom")),
      };

      bus.register("test:void", handler);
      bus.use(loggingMiddleware((msg) => logs.push(msg)));

      await expect(
        bus.dispatch({ type: "test:void" } as VoidCommand),
      ).rejects.toThrow("boom");

      expect(logs[1]).toContain("✗ test:void");
    });
  });

  describe("createPluginQueryCommand", () => {
    it("creates valid command shape", () => {
      const cmd = createPluginQueryCommand("onet.pl", "browse", "voice");

      expect(cmd).toEqual({
        type: "plugin:query",
        intent: "browse",
        rawInput: "onet.pl",
        source: "voice",
        resolvedTarget: undefined,
      });
    });
  });

  describe("registeredCommands", () => {
    it("lists all registered command types", () => {
      bus.register("cmd:a", { execute: vi.fn() });
      bus.register("cmd:b", { execute: vi.fn() });

      expect(bus.registeredCommands).toEqual(
        expect.arrayContaining(["cmd:a", "cmd:b"]),
      );
    });
  });
});
