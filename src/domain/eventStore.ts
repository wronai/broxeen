import { createScopedLogger } from "../lib/logger";
import type { DomainEvent } from "./chatEvents";

const esLogger = createScopedLogger("domain:eventStore");

type EventHandler = (event: DomainEvent) => void;

/**
 * In-memory Event Store with pub/sub capabilities.
 *
 * Stores all domain events in append-only log.
 * Subscribers are notified on each append.
 * Projections rebuild state from the event log.
 */
export class EventStore {
  private events: DomainEvent[] = [];
  private subscribers = new Map<string, Set<EventHandler>>();
  private globalSubscribers = new Set<EventHandler>();

  /** Append a domain event and notify subscribers. */
  append(event: DomainEvent): void {
    this.events.push(event);
    esLogger.debug("Event appended", {
      type: event.type,
      totalEvents: this.events.length,
    });

    // Notify type-specific subscribers
    const handlers = this.subscribers.get(event.type);
    if (handlers) {
      for (const handler of handlers) {
        try {
          handler(event);
        } catch (err) {
          esLogger.error("Event handler threw", {
            type: event.type,
            error: err,
          });
        }
      }
    }

    // Notify global subscribers
    for (const handler of this.globalSubscribers) {
      try {
        handler(event);
      } catch (err) {
        esLogger.error("Global event handler threw", {
          type: event.type,
          error: err,
        });
      }
    }
  }

  /**
   * Subscribe to events of a specific type.
   * Returns an unsubscribe function.
   */
  on<T extends DomainEvent["type"]>(
    type: T,
    handler: (event: Extract<DomainEvent, { type: T }>) => void,
  ): () => void {
    if (!this.subscribers.has(type)) {
      this.subscribers.set(type, new Set());
    }
    this.subscribers.get(type)!.add(handler as EventHandler);
    esLogger.debug("Subscriber added", { type });

    return () => {
      this.subscribers.get(type)?.delete(handler as EventHandler);
      esLogger.debug("Subscriber removed", { type });
    };
  }

  /**
   * Subscribe to ALL events.
   * Returns an unsubscribe function.
   */
  onAll(handler: EventHandler): () => void {
    this.globalSubscribers.add(handler);
    return () => {
      this.globalSubscribers.delete(handler);
    };
  }

  /** Get all events, optionally filtered by type. */
  getEvents(filter?: {
    type?: DomainEvent["type"];
    since?: number;
  }): DomainEvent[] {
    let result = this.events;

    if (filter?.type) {
      result = result.filter((e) => e.type === filter.type);
    }
    if (filter?.since !== undefined) {
      result = result.filter((e) => {
        const ts =
          "timestamp" in e ? (e as { timestamp: number }).timestamp : 0;
        return ts >= filter.since!;
      });
    }

    return result;
  }

  /** Run a projector function over all events to derive state. */
  project<T>(projector: (events: DomainEvent[]) => T): T {
    return projector(this.events);
  }

  /** Get the total number of stored events. */
  get size(): number {
    return this.events.length;
  }

  /** Clear all events (for testing). */
  clear(): void {
    this.events = [];
    esLogger.debug("Event store cleared");
  }
}
