/**
 * @file websocket-compat.ts
 * @description Garante compatibilidade de inicialização do `@supabase/supabase-js` em Node.js 20
 * ou ambientes serverless sem `globalThis.WebSocket` nativo habilitado por padrão.
 *
 * Contexto técnico: a partir de `@supabase/realtime-js` 2.104+, instanciar `createClient(...)`
 * valida a presença de `globalThis.WebSocket` imediatamente no construtor, mesmo em rotas de
 * servidor que utilizam apenas Auth e PostgREST via HTTP (sem canais Realtime).
 * No navegador e em Node.js 22+, `globalThis.WebSocket` já existe nativamente e nada é alterado.
 */

class WebSocketInativoServidor extends EventTarget {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;

  readonly CONNECTING = 0;
  readonly OPEN = 1;
  readonly CLOSING = 2;
  readonly CLOSED = 3;
  readonly readyState = 3;
  readonly url: string;
  readonly protocol = "";
  readonly extensions = "";
  readonly bufferedAmount = 0;
  binaryType: BinaryType = "blob";

  onopen: ((this: WebSocket, ev: Event) => unknown) | null = null;
  onmessage: ((this: WebSocket, ev: MessageEvent) => unknown) | null = null;
  onclose: ((this: WebSocket, ev: CloseEvent) => unknown) | null = null;
  onerror: ((this: WebSocket, ev: Event) => unknown) | null = null;

  constructor(url: string | URL) {
    super();
    this.url = String(url);
  }

  close(): void {
    // Intencionalmente vazio: o servidor não abre conexões WebSocket Realtime.
  }

  send(): void {
    throw new Error(
      "Conexão WebSocket Realtime não suportada neste runtime sem WebSocket nativo (use Node.js 22+).",
    );
  }
}

export function garantirWebSocketGlobal(): void {
  if (typeof globalThis.WebSocket === "undefined") {
    (globalThis as unknown as { WebSocket: unknown }).WebSocket = WebSocketInativoServidor;
  }
}

garantirWebSocketGlobal();
