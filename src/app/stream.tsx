import { createContext, use, useContext, type ReactNode } from 'react';
import { HydrationBoundary, type DehydratedState } from '@tanstack/react-query';
import { serialize } from './serialize';
export type StreamSlotName = 'weather' | 'viewer';
export type StreamPacket = {
  slot: StreamSlotName;
  state: DehydratedState;
  userId?: string | null;
  failed?: boolean;
};
export type StreamState = { id: string; slots: StreamSlotName[]; deadlineMs: number };
export type StreamResources = Partial<Record<StreamSlotName, Promise<StreamPacket>>>;
export const StreamContext = createContext<{
  state: StreamState;
  resources: StreamResources;
} | null>(null);
export function StreamSlot({
  name,
  children,
}: {
  name: StreamSlotName;
  children: (packet?: StreamPacket) => ReactNode;
}) {
  const context = useContext(StreamContext);
  const pending = context?.resources[name];
  if (!pending) return children();
  return (
    <Resolved pending={pending} id={context!.state.id}>
      {children}
    </Resolved>
  );
}
function Resolved({
  pending,
  id,
  children,
}: {
  pending: Promise<StreamPacket>;
  id: string;
  children: (packet: StreamPacket) => ReactNode;
}) {
  const packet = use(pending);
  return (
    <HydrationBoundary state={packet.state}>
      <span
        dangerouslySetInnerHTML={{
          // Parsed server HTML executes this once. An ordinary client remount
          // keeps it inert, without asking React to execute a script element.
          __html: `<script data-cmon-stream="${packet.slot}">window.__cmonStream?.push(${serialize({ id, ...packet })})</script>`,
        }}
      />
      {children(packet)}
    </HydrationBoundary>
  );
}
export function streamBootstrap(state: StreamState) {
  return `window.__cmonStream={id:${serialize(state.id)},packets:[],push:function(p){if(p.id!==this.id)return;this.packets.push(p);this.receive?.(p)}};`;
}
export function receiveStream(state: StreamState): StreamResources {
  const stream = (
    window as unknown as {
      __cmonStream?: {
        id: string;
        packets: (StreamPacket & { id: string })[];
        receive?: (p: StreamPacket & { id: string }) => void;
      };
    }
  ).__cmonStream;
  const resolvers = new Map<StreamSlotName, (p: StreamPacket) => void>();
  const resources: StreamResources = {};
  for (const slot of state.slots)
    resources[slot] = new Promise((resolve) => resolvers.set(slot, resolve));
  const waiting = new Map<StreamSlotName, StreamPacket>();
  const observer = new MutationObserver(deliver);
  observer.observe(document, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['hidden'],
  });
  function dispose() {
    observer.disconnect();
    waiting.clear();
    if (stream?.id === state.id) {
      stream.receive = undefined;
      stream.packets.length = 0;
    }
  }
  // React places late HTML in a hidden segment before its completion script moves
  // it into the boundary. Hydrating earlier races that move and duplicates UI.
  function deliver() {
    for (const [slot, packet] of waiting) {
      const element = document.querySelector(`script[data-cmon-stream="${slot}"]`);
      if (!element?.isConnected || element.closest('[hidden]')) continue;
      resolvers.get(slot)?.(packet);
      resolvers.delete(slot);
      waiting.delete(slot);
    }
    if (!resolvers.size) {
      clearTimeout(timer);
      dispose();
    }
  }
  const timer = setTimeout(() => {
    for (const [slot, resolve] of resolvers)
      resolve({ slot, state: { queries: [], mutations: [] }, failed: true });
    resolvers.clear();
    dispose();
  }, state.deadlineMs + 1000);
  const receive = (packet: StreamPacket & { id: string }) => {
    if (packet.id !== state.id || !resolvers.has(packet.slot)) return;
    waiting.set(packet.slot, packet);
    deliver();
  };
  if (stream?.id === state.id) {
    stream.receive = receive;
    stream.packets.forEach(receive);
  }
  return resources;
}
