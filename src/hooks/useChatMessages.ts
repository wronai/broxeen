import { useState, useEffect } from "react";
import { useCqrs } from "../contexts/CqrsContext";
import type { ChatMessage } from "../domain/chatEvents";

/**
 * useChatMessages — bridges the CQRS Event Sourcing model with React State.
 * Subscribes to the EventStore and updates state via GetMessagesQuery.
 */
export function useChatMessages() {
  const { eventStore, queries } = useCqrs();
  const [messages, setMessages] = useState<readonly ChatMessage[]>(() =>
    queries.getMessages.execute(),
  );

  useEffect(() => {
    // Subscriber to update React state whenever an event is applied
    const unsubscribe = eventStore.onAll(() => {
      setMessages([...queries.getMessages.execute()]);
    });

    return unsubscribe;
  }, [eventStore, queries.getMessages]);

  return messages;
}
