/**
 * @file websocket-compat.test.ts
 * @description Valida a compatibilidade de inicialização de `globalThis.WebSocket`
 * para ambientes Node.js sem WebSocket global nativo (ex.: Node 20 sem flag experimental).
 */

import { afterEach, describe, expect, it } from "vitest";
import { garantirWebSocketGlobal } from "@/lib/websocket-compat";

describe("garantirWebSocketGlobal", () => {
  const originalWebSocket = globalThis.WebSocket;

  afterEach(() => {
    (globalThis as unknown as { WebSocket: unknown }).WebSocket = originalWebSocket;
  });

  it("preserva WebSocket nativo quando já existe no ambiente", () => {
    class WebSocketNativoSimulado {}
    (globalThis as unknown as { WebSocket: unknown }).WebSocket = WebSocketNativoSimulado;

    garantirWebSocketGlobal();

    expect(globalThis.WebSocket).toBe(WebSocketNativoSimulado);
  });

  it("registra construtor compatível inativo quando globalThis.WebSocket está ausente", () => {
    (globalThis as unknown as { WebSocket: unknown }).WebSocket = undefined;

    garantirWebSocketGlobal();

    expect(typeof globalThis.WebSocket).toBe("function");
    const instancia = new globalThis.WebSocket("wss://exemplo.local/realtime");
    expect(instancia.url).toBe("wss://exemplo.local/realtime");
    expect(instancia.readyState).toBe(3);
    expect(() => instancia.close()).not.toThrow();
    expect(() => instancia.send("ping")).toThrow(/Conexão WebSocket Realtime não suportada/);
  });
});
