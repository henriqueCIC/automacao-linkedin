/**
 * Servidor HTTP local determinístico que simula Supabase (GoTrue + PostgREST),
 * GitHub REST API, Google Gemini API e LinkedIn UGC API exclusivamente para testes E2E.
 * Garante zero chamadas externas, zero cobrança de APIs e zero publicações em contas reais.
 */

import http from "node:http";
import { createCipheriv, createHmac, randomBytes, randomUUID } from "node:crypto";

export const E2E_ENCRYPTION_SECRET = Buffer.alloc(32, 9).toString("base64");

function encryptForMockDb(plaintext) {
  const key = Buffer.from(E2E_ENCRYPTION_SECRET, "base64");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ct]).toString("base64");
}

function criarJwtSimulado(user) {
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const nowSec = Math.floor(Date.now() / 1000);
  const payload = Buffer.from(
    JSON.stringify({
      sub: user.id,
      email: user.email,
      aud: "authenticated",
      role: "authenticated",
      iat: nowSec,
      exp: nowSec + 3600,
      user_metadata: user.user_metadata,
    }),
  ).toString("base64url");
  const sig = createHmac("sha256", "e2e-jwt-secret")
    .update(`${header}.${payload}`)
    .digest("base64url");
  return `${header}.${payload}.${sig}`;
}

function decodificarSubDoBearer(authHeader) {
  if (!authHeader || !authHeader.startsWith("Bearer ")) return null;
  const partes = authHeader.slice(7).split(".");
  if (partes.length !== 3) return null;
  try {
    const payload = JSON.parse(Buffer.from(partes[1], "base64url").toString("utf8"));
    return typeof payload.sub === "string" ? payload.sub : null;
  } catch {
    return null;
  }
}

const USUARIOS_FIXOS = [
  {
    id: "11111111-1111-4111-8111-111111111111",
    email: "ana@exemplo.com",
    password: "senha-segura-ana",
    user_metadata: { full_name: "Ana Silva" },
  },
  {
    id: "22222222-2222-4222-8222-222222222222",
    email: "bruno@exemplo.com",
    password: "senha-segura-bruno",
    user_metadata: { full_name: "Bruno Costa" },
  },
];

function criarEstadoInicial() {
  const agoraIso = new Date().toISOString();
  return {
    failNextGemini: false,
    publishedLinkedInPosts: [],
    tables: {
      automation_settings: [
        {
          user_id: USUARIOS_FIXOS[0].id,
          enabled: true,
          daily_time: "18:00",
          timezone: "America/Bahia",
          default_tone: "profissional",
          max_commits_per_day: 15,
          notify_desktop: true,
          notify_email: false,
          last_run_date: null,
          created_at: agoraIso,
          updated_at: agoraIso,
        },
      ],
      app_user_connections: [
        {
          id: randomUUID(),
          user_id: USUARIOS_FIXOS[0].id,
          connector_id: "github",
          connection_key_ciphertext: encryptForMockDb("gho_e2e_token_ana"),
          account_login: "ana-dev",
          reconnect_required: false,
          created_at: agoraIso,
          updated_at: agoraIso,
        },
        {
          id: randomUUID(),
          user_id: USUARIOS_FIXOS[0].id,
          connector_id: "linkedin",
          connection_key_ciphertext: encryptForMockDb("li_e2e_token_ana"),
          account_login: "ana-linkedin",
          reconnect_required: false,
          created_at: agoraIso,
          updated_at: agoraIso,
        },
      ],
      collection_runs: [],
      seen_commits: [],
      day_entries: [],
      post_drafts: [],
      cron_secrets: [{ id: 1, secret: "e2e-cron-secret", created_at: agoraIso }],
    },
  };
}

function lerCorpo(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
  });
}

function responderJson(res, status, dados) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "*",
    "Access-Control-Allow-Methods": "GET,POST,PATCH,PUT,DELETE,OPTIONS",
  });
  res.end(dados === undefined ? "" : JSON.stringify(dados));
}

function aplicarFiltrosPostgrest(linhas, searchParams, rlsUserId) {
  return linhas.filter((linha) => {
    if (rlsUserId && "user_id" in linha && linha.user_id !== rlsUserId) {
      return false;
    }
    for (const [chave, valor] of searchParams.entries()) {
      if (chave === "select" || chave === "order" || chave === "limit" || chave === "on_conflict") {
        continue;
      }
      if (valor.startsWith("eq.")) {
        const alvo = valor.slice(3);
        if (String(linha[chave]) !== alvo) return false;
      } else if (valor.startsWith("neq.")) {
        const alvo = valor.slice(4);
        if (String(linha[chave]) === alvo) return false;
      } else if (valor === "is.null") {
        if (linha[chave] !== null && linha[chave] !== undefined) return false;
      } else if (valor.startsWith("in.(") && valor.endsWith(")")) {
        const opcoes = valor
          .slice(4, -1)
          .split(",")
          .map((item) => item.replace(/^"|"$/g, ""));
        if (!opcoes.includes(String(linha[chave]))) return false;
      } else if (valor.startsWith("gte.")) {
        const alvo = valor.slice(4);
        if (String(linha[chave] ?? "") < alvo) return false;
      }
    }
    return true;
  });
}

export function iniciarServidorMockE2E(porta = 54329) {
  let state = criarEstadoInicial();

  const server = http.createServer(async (req, res) => {
    if (req.method === "OPTIONS") {
      responderJson(res, 204, undefined);
      return;
    }

    const url = new URL(req.url ?? "/", `http://127.0.0.1:${porta}`);
    const pathname = url.pathname;
    const corpoTexto = await lerCorpo(req);

    // 1. Endpoints de controle do ambiente de teste E2E
    if (pathname === "/__control/reset" && req.method === "POST") {
      state = criarEstadoInicial();
      const cfg = corpoTexto ? JSON.parse(corpoTexto) : {};
      if (cfg.failNextGemini) state.failNextGemini = true;
      responderJson(res, 200, { ok: true });
      return;
    }

    if (pathname === "/__control/config" && req.method === "POST") {
      const cfg = corpoTexto ? JSON.parse(corpoTexto) : {};
      if (typeof cfg.failNextGemini === "boolean") {
        state.failNextGemini = cfg.failNextGemini;
      }
      responderJson(res, 200, { ok: true });
      return;
    }

    if (pathname === "/__control/state" && req.method === "GET") {
      responderJson(res, 200, {
        publishedLinkedInPosts: state.publishedLinkedInPosts,
        draftsCount: state.tables.post_drafts.length,
        seenCommitsCount: state.tables.seen_commits.length,
      });
      return;
    }

    // 2. Supabase Auth (GoTrue)
    if (pathname === "/auth/v1/settings" && req.method === "GET") {
      responderJson(res, 200, {
        external: {
          email: true,
          google: true,
          github: false,
        },
      });
      return;
    }

    if (pathname === "/auth/v1/authorize" && req.method === "GET") {
      responderJson(res, 400, {
        code: 400,
        error_code: "validation_failed",
        msg: "Unsupported provider: missing OAuth secret",
      });
      return;
    }

    if (pathname === "/auth/v1/token" && req.method === "POST") {
      const body = corpoTexto ? JSON.parse(corpoTexto) : {};
      const user = USUARIOS_FIXOS.find(
        (u) => u.email === body.email && u.password === body.password,
      );
      if (!user) {
        responderJson(res, 400, {
          code: "invalid_credentials",
          msg: "E-mail ou senha inválidos.",
        });
        return;
      }
      const token = criarJwtSimulado(user);
      const nowSec = Math.floor(Date.now() / 1000);
      responderJson(res, 200, {
        access_token: token,
        token_type: "bearer",
        expires_in: 3600,
        expires_at: nowSec + 3600,
        refresh_token: `rt-${user.id}`,
        user: {
          id: user.id,
          aud: "authenticated",
          role: "authenticated",
          email: user.email,
          user_metadata: user.user_metadata,
        },
      });
      return;
    }

    if (pathname === "/auth/v1/user" && req.method === "GET") {
      const sub = decodificarSubDoBearer(req.headers.authorization);
      const user = USUARIOS_FIXOS.find((u) => u.id === sub);
      if (!user) {
        responderJson(res, 401, { msg: "Sessão inválida." });
        return;
      }
      responderJson(res, 200, {
        id: user.id,
        aud: "authenticated",
        role: "authenticated",
        email: user.email,
        user_metadata: user.user_metadata,
      });
      return;
    }

    if (pathname === "/auth/v1/logout") {
      responderJson(res, 204, undefined);
      return;
    }

    // 3. Supabase PostgREST (/rest/v1/:table)
    if (pathname.startsWith("/rest/v1/")) {
      const nomeTabela = pathname.slice("/rest/v1/".length);
      const tabela = state.tables[nomeTabela];
      if (!tabela) {
        responderJson(res, 404, { message: `Tabela não encontrada: ${nomeTabela}` });
        return;
      }

      const apikey = String(req.headers["apikey"] ?? "");
      const ehServiceRole = apikey.startsWith("sb_secret_");
      const rlsUserId = ehServiceRole ? null : decodificarSubDoBearer(req.headers.authorization);

      const accept = String(req.headers["accept"] ?? "");
      const prefereObjetoUnico = accept.includes("application/vnd.pgrst.object+json");
      const prefer = String(req.headers["prefer"] ?? "");

      const enriquecerRelacoes = (linha) => {
        const copia = { ...linha };
        const selectParam = url.searchParams.get("select") ?? "";
        if (nomeTabela === "post_drafts" && selectParam.includes("day_entries(")) {
          copia.day_entries =
            state.tables.day_entries.find((e) => e.id === copia.day_entry_id) ?? null;
        }
        return copia;
      };

      const responderResultadoPostgrest = (linhas, statusPadrao = 200) => {
        const enriquecidas = linhas.map(enriquecerRelacoes);
        if (prefereObjetoUnico) {
          if (enriquecidas.length !== 1) {
            responderJson(res, 406, {
              code: "PGRST116",
              details: `The result contains ${enriquecidas.length} rows`,
              hint: null,
              message: "JSON object requested, multiple (or no) rows returned",
            });
            return;
          }
          responderJson(res, statusPadrao, enriquecidas[0]);
          return;
        }
        responderJson(res, statusPadrao, enriquecidas);
      };

      if (req.method === "GET") {
        let filtradas = aplicarFiltrosPostgrest(tabela, url.searchParams, rlsUserId);
        const orderParam = url.searchParams.get("order");
        if (orderParam) {
          const [col, dir] = orderParam.split(".");
          filtradas = [...filtradas].sort((a, b) => {
            const va = String(a[col] ?? "");
            const vb = String(b[col] ?? "");
            return dir === "desc" ? vb.localeCompare(va) : va.localeCompare(vb);
          });
        }
        const limitParam = url.searchParams.get("limit");
        if (limitParam) {
          filtradas = filtradas.slice(0, Number(limitParam));
        }
        responderResultadoPostgrest(filtradas, 200);
        return;
      }

      if (req.method === "POST") {
        const payload = corpoTexto ? JSON.parse(corpoTexto) : {};
        const itens = Array.isArray(payload) ? payload : [payload];
        const onConflict = url.searchParams.get("on_conflict");
        const chavesConflito = onConflict ? onConflict.split(",") : null;
        const gravados = [];

        for (const item of itens) {
          const agora = new Date().toISOString();
          const novo = {
            ...(nomeTabela !== "automation_settings" && nomeTabela !== "cron_secrets"
              ? { id: item.id ?? randomUUID() }
              : {}),
            created_at: item.created_at ?? agora,
            updated_at: item.updated_at ?? agora,
            ...item,
          };

          if (chavesConflito && prefer.includes("resolution=merge-duplicates")) {
            const idx = tabela.findIndex((existente) =>
              chavesConflito.every((k) => existente[k] === novo[k]),
            );
            if (idx >= 0) {
              tabela[idx] = { ...tabela[idx], ...novo, updated_at: agora };
              gravados.push(tabela[idx]);
              continue;
            }
          }

          tabela.push(novo);
          gravados.push(novo);
        }

        responderResultadoPostgrest(gravados, 201);
        return;
      }

      if (req.method === "PATCH") {
        const patch = corpoTexto ? JSON.parse(corpoTexto) : {};
        const alvos = aplicarFiltrosPostgrest(tabela, url.searchParams, rlsUserId);
        const atualizados = [];
        for (const alvo of alvos) {
          Object.assign(alvo, patch, { updated_at: new Date().toISOString() });
          atualizados.push(alvo);
        }
        if (prefer.includes("return=representation") || prefereObjetoUnico) {
          responderResultadoPostgrest(atualizados, 200);
        } else {
          responderJson(res, 204, undefined);
        }
        return;
      }

      if (req.method === "DELETE") {
        const manter = [];
        const alvoSet = new Set(aplicarFiltrosPostgrest(tabela, url.searchParams, rlsUserId));
        for (const item of tabela) {
          if (!alvoSet.has(item)) manter.push(item);
        }
        state.tables[nomeTabela] = manter;
        responderJson(res, 204, undefined);
        return;
      }
    }

    // 4. GitHub API Simulada (/github/...)
    if (pathname === "/github/user" && req.method === "GET") {
      responderJson(res, 200, { login: "ana-dev" });
      return;
    }

    if (pathname === "/github/user/repos" && req.method === "GET") {
      responderJson(res, 200, [
        {
          full_name: "ana-dev/automacao-linkedin",
          name: "automacao-linkedin",
          owner: { login: "ana-dev" },
          pushed_at: new Date().toISOString(),
          private: false,
        },
      ]);
      return;
    }

    if (pathname === "/github/repos/ana-dev/automacao-linkedin/commits" && req.method === "GET") {
      responderJson(res, 200, [
        {
          sha: "e2e111222333444555666777888999000aaabbbc",
          html_url: "https://github.com/ana-dev/automacao-linkedin/commit/e2e1112",
          commit: {
            message: "feat: adiciona validação com Zod e testes E2E no fluxo de revisão",
            author: {
              name: "Ana Silva",
              email: "ana@exemplo.com",
              date: new Date().toISOString(),
            },
          },
        },
      ]);
      return;
    }

    if (
      pathname.startsWith("/github/repos/ana-dev/automacao-linkedin/commits/") &&
      req.method === "GET"
    ) {
      const sha = pathname.split("/").pop();
      responderJson(res, 200, {
        sha,
        html_url: `https://github.com/ana-dev/automacao-linkedin/commit/${sha}`,
        commit: {
          message: "feat: adiciona validação com Zod e testes E2E no fluxo de revisão",
          author: { date: new Date().toISOString() },
        },
        files: [
          {
            filename: "src/lib/ai.server.ts",
            status: "modified",
            additions: 24,
            deletions: 4,
            patch:
              "+ export const SaidaRascunhoIASchema = z.object({ summary: z.string(), content: z.string() });",
          },
        ],
      });
      return;
    }

    // 5. Google Gemini API Simulada (/gemini/v1beta/models/...)
    if (pathname.startsWith("/gemini/v1beta/models/") && req.method === "POST") {
      if (state.failNextGemini) {
        state.failNextGemini = false;
        responderJson(res, 500, { error: { message: "Erro simulado no Gemini E2E" } });
        return;
      }

      const body = corpoTexto ? JSON.parse(corpoTexto) : {};
      const textoUsuario = body?.contents?.[0]?.parts?.[0]?.text ?? "";
      const ehRefinamento = textoUsuario.includes("Ajustes pedidos pela pessoa");

      const rascunho = ehRefinamento
        ? {
            summary: "Validação com schemas Zod, testes E2E e revisão colaborativa em equipe.",
            content:
              "Hoje concluímos em equipe a camada de validação com Zod e os testes ponta a ponta da nossa automação para LinkedIn. Garantimos que nenhum texto seja publicado sem aprovação humana explícita. #TypeScript #Qualidade #EngenhariaDeSoftware",
          }
        : {
            summary: "Implementada validação de schemas Zod na camada de IA e suíte de testes E2E.",
            content:
              "Hoje avancei na confiabilidade da nossa automação de posts técnicos: adicionei schemas em tempo de execução com Zod e testes ponta a ponta cobrindo coleta, revisão e aprovação humana antes da publicação. #TypeScript #Testes #IA",
          };

      responderJson(res, 200, {
        candidates: [{ content: { parts: [{ text: JSON.stringify(rascunho) }] } }],
      });
      return;
    }

    // 6. LinkedIn API Simulada (/linkedin/v2/...) — NUNCA publica em conta real
    if (pathname === "/linkedin/v2/userinfo" && req.method === "GET") {
      responderJson(res, 200, { sub: "ana-linkedin-sub", name: "Ana Silva" });
      return;
    }

    if (pathname === "/linkedin/v2/ugcPosts" && req.method === "POST") {
      const payload = corpoTexto ? JSON.parse(corpoTexto) : {};
      const postId = `urn:li:share:simulado-${1000 + state.publishedLinkedInPosts.length + 1}`;
      state.publishedLinkedInPosts.push({ id: postId, payload });
      responderJson(res, 201, { id: postId });
      return;
    }

    if (pathname.startsWith("/linkedin/v2/ugcPosts/") && req.method === "GET") {
      responderJson(res, 200, { lifecycleState: "PUBLISHED" });
      return;
    }

    responderJson(res, 404, { error: `Rota mock não mapeada: ${req.method} ${pathname}` });
  });

  return new Promise((resolve) => {
    server.listen(porta, "127.0.0.1", () => resolve(server));
  });
}
