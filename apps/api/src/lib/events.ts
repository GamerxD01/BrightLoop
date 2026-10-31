import { EventEmitter } from 'node:events';
import type { EventType } from '@brightloop/shared';

/**
 * In-process event bus behind the Server-Sent Events endpoint.
 * Services publish after their transaction commits. With more than one API
 * instance this is the single place to swap for Postgres LISTEN/NOTIFY.
 */
export interface AppEvent {
  type: EventType;
  data: Record<string, unknown>;
  /** Portal customer allowed to receive this event; staff receive everything. */
  customerId?: number | null;
}

class EventBus extends EventEmitter {
  publish(event: AppEvent): void {
    this.emit('event', event);
  }
}

export const events = new EventBus();
events.setMaxListeners(1000);
