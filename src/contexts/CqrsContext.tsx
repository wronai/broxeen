import { createContext, useContext, useEffect, useMemo, useRef } from "react";
import { EventStore } from "../domain/eventStore";
import { ChatAggregate } from "../domain/chatAggregate";
import { DefaultBrowseAdapter } from "../services/defaultBrowseAdapter";
import { DefaultLlmAdapter } from "../services/defaultLlmAdapter";
import { BrowseCommand } from "../commands/browseCommand";
import { SendMessageCommand } from "../commands/sendMessageCommand";
import { CopyContextCommand } from "../commands/copyContextCommand";
import { GetMessagesQuery } from "../queries/getMessagesQuery";

interface CqrsContextValue {
  eventStore: EventStore;
  aggregate: ChatAggregate;
  commands: {
    browse: BrowseCommand;
    sendMessage: SendMessageCommand;
    copyContext: CopyContextCommand;
  };
  queries: {
    getMessages: GetMessagesQuery;
  };
}

const CqrsContext = createContext<CqrsContextValue | null>(null);

export function CqrsProvider({ children }: { children: React.ReactNode }) {
  // Store singletons in refs so they survive re-renders
  const storeRef = useRef<EventStore | null>(null);
  const aggregateRef = useRef<ChatAggregate | null>(null);

  if (!storeRef.current) {
    storeRef.current = new EventStore();
    aggregateRef.current = new ChatAggregate();

    // Wire up aggregate to listen to store events automatically
    storeRef.current.onAll((event) => {
      aggregateRef.current!.apply(event);
    });
  }

  const value = useMemo(() => {
    const store = storeRef.current!;
    const aggregate = aggregateRef.current!;
    const browseAdapter = new DefaultBrowseAdapter();
    const llmAdapter = import.meta.env.VITE_OPENROUTER_API_KEY
      ? new DefaultLlmAdapter()
      : null;

    return {
      eventStore: store,
      aggregate,
      commands: {
        browse: new BrowseCommand(store, aggregate, browseAdapter, llmAdapter),
        sendMessage: new SendMessageCommand(store, aggregate, llmAdapter!),
        copyContext: new CopyContextCommand(aggregate),
      },
      queries: {
        getMessages: new GetMessagesQuery(aggregate),
      },
    };
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      storeRef.current?.clear();
    };
  }, []);

  return <CqrsContext.Provider value={value}>{children}</CqrsContext.Provider>;
}

export function useCqrs() {
  const context = useContext(CqrsContext);
  if (!context) {
    throw new Error("useCqrs must be used within a CqrsProvider");
  }
  return context;
}
