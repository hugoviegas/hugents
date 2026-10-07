# Hugents: Especificação do Projeto

Versão 0.1 · 7 de outubro de 2026 · Status: design em andamento, nada executável ainda.

Este documento reúne tudo o que foi decidido, pesquisado e deixado em aberto sobre o Hugents até agora. Ele serve como fonte única para quem for implementar (humano ou IA). Onde um fato vem de pesquisa externa, há uma nota para reverificar antes de depender dele, porque limites de planos gratuitos mudam.

---

## 1. Visão

Hugents é um sistema de agentes de QA que testa qualquer projeto web. Ele roda de graça, é local primeiro e mostra o trabalho dos agentes em um "escritório" interativo.

O primeiro projeto testado é o Big Bang Duel, um jogo de cartas no navegador. O sistema nasceu como um protótipo dentro do repositório do jogo (`duel-agent-office`) e agora vira um projeto independente, em repositório próprio e público, que se comunica com os projetos testados por meio de manifests.

Objetivos:

1. Executar cenários reais no navegador (Playwright) contra ambientes de teste, nunca contra produção.
2. Coletar evidências sanitizadas e transformá-las em findings determinísticos.
3. Usar IA (Gemini) apenas para interpretar e redigir relatórios, nunca para escolher ferramentas.
4. Permitir que o dono administre tudo com login e que visitantes vejam, sem login, apenas sessões marcadas como públicas.
5. Servir como peça de portfólio, mostrando trabalho real e não simulado.
6. Ter um criador de testes que explora páginas e propõe testes para aprovação humana.

## 2. Princípios

- **Gratuito de operar.** Toda a stack deve caber em planos gratuitos.
- **Local primeiro.** O worker pode rodar no computador do dono, sem depender de nuvem.
- **Verdadeiro.** A interface nunca mostra atividade que não aconteceu. Sem evento real, o agente fica parado. Respirar e piscar são cosméticos e permitidos.
- **Sanitizado por padrão.** Todo dado passa por um sanitizador antes de sair do worker.
- **Independente de projeto.** Nada do jogo fica no código do Hugents. Cada projeto é descrito por um manifest.
- **Aprovação humana.** Nada é escrito em sistema de terceiros (GitHub, por exemplo) sem aprovação explícita.
- **Determinístico primeiro.** Regras e código vêm antes de modelos. Um modelo indisponível nunca bloqueia a coleta de evidências.

## 3. Origem e estado atual

Já existe, no repositório do jogo, um protótipo que serve de referência:

| Item | O que entregou | Estado |
|---|---|---|
| Issue #93 | Issue-mãe do "local QA agent office" | Aberta |
| Issue #94 / PR #95 | Runner determinístico de partida privada (dois jogadores, Playwright, eventos JSONL, bloqueio de produção, retenção de artefatos, `agent:sync-preview`) | Concluída e mergeada |
| Issue #96 / PR #97 | Observer local, `findings.json` determinístico e dashboard local | PR aberta; dashboard validado visualmente |
| Issue #98 / PR #99 | Agentes com playbooks fixos, bridge local, cenário `explore-screens`, relatórios com provider de IA | PR aberta, em ajustes |

Resultados observados do protótipo:

- Três partidas privadas completas, sem intervenção manual. Todas terminaram em empate porque os dois jogadores usavam a mesma política. Uma execução posterior terminou com vitória e derrota.
- Um erro `he is not a function` apareceu cinco vezes em uma execução e não se repetiu. Continua como observação, não como bug confirmado.
- Requisições `net::ERR_ABORTED` aparecem e são ignoradas por padrão.
- O front-end do AgentOffice de terceiros foi considerado insatisfatório e será substituído. Seus contratos úteis (eventos, tarefas, findings, providers) serão extraídos para o Hugents.

O repositório `hugents` já tem a PR #1 com o scaffold de documentação (README, `SECURITY.md`, `CONTRIBUTING.md`, templates, `CODEOWNERS`, `dependabot.yml`, pastas de pacotes). Pendência conhecida: essa PR apaga o `LICENSE` MIT por engano e precisa restaurá-lo antes do merge.

## 4. Decisões tomadas

| # | Decisão | Motivo |
|---|---|---|
| D1 | Repositório próprio, público, chamado `hugents` | Reuso entre projetos e portfólio |
| D2 | Licença MIT | Escolhida no formulário de criação |
| D3 | TypeScript em Node | Mesma linguagem do runner atual |
| D4 | Playwright como motor de navegação | Já validado no jogo |
| D5 | Firebase em projeto **próprio** (`hugents`), separado do jogo e do projeto de QA do jogo | Isolamento de cotas, chaves e dados |
| D6 | Firestore como persistência, atrás de uma interface `Store` | Auth e tempo real prontos; troca futura possível |
| D7 | Worker local no computador do dono | Oracle Micro não comporta Playwright |
| D8 | GitHub Actions como segundo worker, agendado ou sob demanda | Gratuito em repositório público |
| D9 | Gemini API como provider de IA, com Ollama opcional e fallback determinístico | Ollama local foi lento no hardware do dono |
| D10 | UI hospedada de forma estática no portfólio do dono | Custo zero |
| D11 | Acesso: login para administração, leitura pública apenas de sessões marcadas como públicas | Pedido do dono |
| D12 | Visibilidade por sessão, padrão **privado** | Segurança |
| D13 | Terminal por SSH e CLI local, sem terminal web exposto | Segurança e simplicidade |
| D14 | Traces, vídeos e screenshots brutas nunca saem do worker | Repositório público |
| D15 | Chat por agente e chat geral, com texto convertido em comandos de uma lista fechada | Evita agente escolhendo ferramentas livremente |

## 5. Decisões em aberto

1. **Tecnologia do mundo visual.** Opções: Canvas 2D próprio (proposta do Claude, sem WebGL, fácil de validar) ou Three.js/React Three Fiber com câmera ortográfica (preferência declarada pelo dono para ter modelos 3D e personagens escolhíveis). Os mockups aprovados usam arte pixelada em vista oblíqua, que funciona com as duas. Decidir antes da fase 6.
2. **Como o painel dispara o worker do GitHub Actions.** Exige um token fino do GitHub guardado em um servidor, nunca no navegador. Falta decidir onde fica essa função mínima (função serverless, ou disparo manual pelo GitHub).
3. **Autenticação do admin.** Firebase Authentication com claim `admin`. Falta escolher o método (passkey, TOTP ou conta Google com MFA).
4. **Visão pública a partir de snapshot ou de leitura direta.** A recomendação é snapshot, para proteger a cota de leituras.
5. **Quadro de findings e de avisos.** A mensagem do dono ficou cortada em "o quadro de…". Confirmar se haverá quadros além do de tarefas.
6. **Worker agendado sem o PC ligado ou só sob demanda.** Define se o GitHub Actions entra na primeira versão.
7. **Política de tela dos agentes.** Quais telas do projeto testado são sempre ocultadas e como os screenshots derivados são gerados.
8. **Modelo do Gemini por função.** Ver seção 14.

## 6. Arquitetura

```text
                 Projeto testado (Preview/QA, nunca produção)
                              ▲
                              │ navegador (Playwright)
┌──────────────────────────── Workers ───────────────────────────┐
│  Worker local (PC do dono)     Worker GitHub Actions (agendado)│
│  Executa tarefas, sanitiza eventos antes de enviar             │
└───────────────────────────────┬────────────────────────────────┘
                                │ eventos e resultados sanitizados
                                ▼
                     Firebase projeto "hugents"
                  Firestore + Authentication (+ Storage opcional)
                                │
              ┌─────────────────┴──────────────────┐
              ▼                                    ▼
      Área privada (login admin)           Área pública (sem login)
   tarefas, chat, editor, findings,        apenas sessões públicas,
   configuração, relatórios                snapshot sanitizado
              │                                    │
              └────────────── UI do escritório ────┘
                         (estática, no portfólio)
```

Regras de fronteira:

- O sanitizador roda **dentro do worker**. Nada bruto atravessa a fronteira.
- Workers falam com o backend apenas por conexões de saída (HTTPS), então nenhuma porta é aberta no computador do dono.
- O Admin SDK ignora as regras de segurança do Firestore. Por isso a chave da conta de serviço existe só no worker, nunca no navegador nem no repositório.

## 7. Componentes

Estrutura de pastas do repositório:

```text
hugents/
  docs/                  arquitetura, segurança, manifest, roadmap, decisões
  packages/
    core/                orquestrador, fila, contrato de eventos, sanitizador, Store
    adapters/            um adapter por projeto, derivado do manifest
    scenarios/           cenários Playwright escritos à mão
    generator/           criador de testes (propõe, nunca aprova sozinho)
    api/                 regras e funções mínimas do backend
    ui/                  escritório
    cli/                 comandos de terminal
  examples/              manifests de exemplo sem dados reais
  .github/               CODEOWNERS, templates, dependabot (workflows só na fase 7)
```

### 7.1 Core

- Fila de tarefas com ciclo de vida fechado.
- Contrato de eventos versionado.
- Sanitizador único, reutilizado por worker, API e UI.
- Interface `Store` com adaptadores para Firestore e SQLite local (cache e desenvolvimento).
- Provedores de IA atrás de uma interface comum.

### 7.2 Adapters e manifest

Cada projeto testado é descrito por um manifest declarativo. Campos planejados:

| Campo | Função |
|---|---|
| `projectId` | Identificador estável |
| `allowedTargetUrlPattern` | Lista de permissão para alvos de teste |
| `blockedTargets` | Alvos proibidos, sempre incluindo produção |
| `testAccountVariableNames` | Nomes das variáveis de ambiente das contas de teste, nunca os valores |
| `availableScenarios` | Cenários disponíveis |
| `screensToHide` | Telas ou regiões sempre ocultadas |
| `forbiddenActions` | Ações proibidas (excluir conta, comprar, etc.) |

Regras: produção é sempre bloqueada; manifests são revisados antes de executar; segredos entram só por nome de variável.

### 7.3 Scenarios

Cenários escritos à mão e reutilizáveis. O primeiro é o `private-match-full-game` do Big Bang Duel, que vira o modelo:

- Alpha cria sala privada pela interface e lê o código exibido.
- Bravo entra pelo formulário com esse código.
- Os dois jogam até o fim, decidindo apenas pelo que é visível na própria mão.
- Trace e vídeo ficam desligados por padrão.

Outros cenários previstos: `explore-screens` (percorre menu, missões, loja, perfil, ranking, personagens, amigos, histórico e conquistas, com um screenshot por tela).

### 7.4 Generator (criador de testes)

O Playwright tem um servidor MCP oficial que dá a um agente um navegador real, e a documentação menciona agentes de teste que rascunham e reparam testes. Reverificar o estado atual antes de depender disso.

Fluxo seguro:

1. O Explorer percorre as páginas do alvo e lista elementos, formulários e rotas pela árvore de acessibilidade.
2. O gerador **propõe** testes como rascunhos. Ele não os executa sozinho em ambientes sensíveis.
3. O dono revisa e aprova.
4. Testes aprovados entram no manifest e rodam pela mesma fila, com o mesmo bloqueio de produção.

A IA nunca escolhe a URL de destino. Ações destrutivas ficam na lista `forbiddenActions` de cada projeto.

### 7.5 API e backend

Firestore e Authentication fazem a maior parte do trabalho. A parte de código é pequena: regras de segurança testadas no emulador e, se necessário, uma função mínima para disparar o GitHub Actions.

### 7.6 CLI

Comandos locais pensados para uso por SSH ou terminal local: iniciar worker, listar tarefas, enviar um comando ao chat de um agente, ver o estado. Não existe terminal web.

## 8. Agentes

Quatro agentes com playbooks fixos no código. O modelo escreve texto, mas **nunca escolhe ferramentas nem parâmetros**.

| Agente | Papel | Ferramentas |
|---|---|---|
| `player-alpha` | Joga partidas de teste | Executar cenário Playwright |
| `explorer` | Navega telas e descobre problemas | `explore-screens`, geração de rascunhos de teste |
| `qa-analyst` | Lê findings e escreve relatório técnico | Ler `findings.json`, provider de IA |
| `design-critic` | Revisa UX e qualidade visual a partir de evidências aprovadas | Screenshots derivadas, provider de IA |

Papéis futuros previstos: Triage Manager, Issue Writer e Skill Coach. Eles só entram depois de existir coleta confiável e uma fase própria aprovada. Nenhum agente cria issues, altera código ou muda configuração sem aprovação humana.

## 9. Contrato de eventos

Um único schema versionado substitui os dois formatos do protótipo (`RunEvent` e `OfficeEvent`). A animação lê campos estruturados, nunca o texto livre.

```text
Event {
  v: 1
  seq: número crescente
  at: carimbo de tempo
  origin: "live" | "demo"
  agent: AgentId | "system"
  status: idle | planning | working | waiting | reviewing | blocked | completed | failed
  phase: enum fechado
  tool?: enum fechado
  taskId?, runId?
  label: texto sanitizado e curto
  artifactRef?: identificador opaco, nunca caminho
}
```

Regras:

- Eventos `demo` nunca entram no estado ao vivo.
- Uma tarefa que espera o lock do runner usa `waiting`, nunca `working`. O protótipo tinha esse defeito.
- Sem evento real, o agente permanece em `idle`.
- Se o backend não responde, a UI mostra "offline, sem dados". Nunca recorre ao modo demo.

## 10. Tarefas e chat

### Quadro de tarefas

Estados: `pending`, `waiting`, `in_progress`, `completed`, `blocked`, `failed`.

Tipos permitidos (lista fechada, com parâmetros validados): executar partida privada, explorar telas, observar artefatos, escrever relatório, revisar screenshots. Tudo que usa Playwright passa por uma fila serial, porque as contas de teste não podem entrar em sessões conflitantes.

### Chat

- Uma conversa por agente e uma conversa geral.
- Mensagens guardam id, sequência, conversa, autor, origem (`live` ou `demo`), tipo (`user`, `agent_report`, `system`), texto sanitizado e tarefa associada.
- O texto digitado pelo dono é convertido em **comando estruturado** de uma lista fechada, por exemplo "rodar explore-screens" ou "analisar o último findings". Texto livre nunca escolhe ferramenta nem parâmetros.
- No chat geral, as mensagens dos agentes vêm apenas de eventos reais. Não há diálogo simulado entre agentes.
- Texto vindo de artefatos, findings ou do próprio chat é **dado**, nunca instrução para o modelo.
- Há limite de tamanho por mensagem, limite de taxa e teto diário de chamadas ao provider.

## 11. Dados e a interface Store

Estrutura sugerida no Firestore:

```text
projects/{projectId}                  resumo do manifest, sem segredos
projects/{projectId}/sessions/{id}    visibility: private | public
sessions/{id}/events/{seq}            evento sanitizado
sessions/{id}/messages/{id}           chat
tasks/{id}                            quadro de tarefas
reports/{id}                          relatórios aprovados
public/live                           snapshot sanitizado para visitantes
```

Regras de desenho:

- Eventos pequenos e agregados. Nada de documento por frame.
- Screenshots não vão para o Firestore.
- A página pública lê um ou poucos documentos (`public/live`). Isso protege a cota de leituras.
- Toda leitura e escrita passa pela interface `Store`. O Firestore é um adaptador; o SQLite local é outro, útil para desenvolvimento e como cache do worker.

Limites do plano gratuito do Firestore (reverificar antes de depender): 1 GiB de armazenamento, 50.000 leituras por dia, 20.000 escritas por dia, 20.000 exclusões por dia e 10 GiB de saída por mês. Ao estourar a cota, o Firestore para de responder até o reset à meia-noite do horário do Pacífico.

Limitações do Firestore: consultas agregadas são limitadas. Relatórios como "quantas vezes este erro apareceu em 30 dias" exigem contadores gravados.

## 12. Autenticação e acesso

| Área | Acesso | Conteúdo |
|---|---|---|
| Pública | Sem login | Somente sessões marcadas como públicas: estado dos agentes, eventos sanitizados, relatórios aprovados para publicação. Somente leitura. Sem chat, sem tarefas, sem screenshots |
| Privada | Login do admin | Tarefas, chat, editor, findings completos, configuração, relatórios |

- Admin pelo Firebase Authentication, com claim personalizada `admin: true` verificada pelas regras do Firestore. Nunca usar um campo gravável pelo cliente.
- Regras do Firestore: leitura pública apenas em `public/*`; todo o resto `allow read, write: if false` para visitantes.
- Regras versionadas e testadas no emulador, nos dois sentidos (acesso permitido e negado).
- Visibilidade é decidida por sessão, com padrão privado. Nada vira público automaticamente.

## 13. Workers

### 13.1 Worker local

Roda no computador do dono. Puxa tarefas do backend, executa o Playwright, sanitiza e envia eventos. Permite uso interativo e não tem limite de minutos. Só funciona com o computador ligado. Se estiver desligado, a UI mostra "worker offline".

### 13.2 Worker no GitHub Actions

Roda agendado ou por `workflow_dispatch`. Não há interação ao vivo; o acompanhamento é feito pelos eventos.

Fatos a reverificar:

- Runners hospedados pelo GitHub são gratuitos em repositórios públicos. Em repositório privado, o plano Free inclui 2.000 minutos por mês e 500 MB de artefatos.
- O token usado para disparar o workflow precisa de permissão de escrita em Actions apenas no repositório do Hugents. Ele fica em servidor, nunca no navegador.

### 13.3 Cuidados específicos de repositório público

| Risco | Medida |
|---|---|
| Logs públicos expõem dados | Logs só com contagens e IDs opacos |
| Artefatos ficam visíveis | Não subir artefatos; screenshots derivadas vão para o backend |
| Workflow alterado em PR | `CODEOWNERS` em `.github/workflows/`, branch protegida, revisão obrigatória |
| Gatilhos perigosos | Nunca usar `pull_request_target` nem `workflow_run` com código não confiável |
| Runner auto-hospedado | Nunca usar em repositório público |
| Segredo impresso | O mascaramento só cobre valores registrados e não impede exfiltração intencional; não imprimir segredos |
| Credencial de longa duração | Preferir OIDC / Workload Identity; confirmar a configuração para Firebase na documentação do Google antes de implementar |

Decisão em aberto: se o Hugents precisar de artefatos ou logs ricos, avaliar mover o worker para um repositório privado de execução (2.000 minutos mensais) e manter o público só com o código.

## 14. IA

Ordem de preferência, configurável por `AI_PROVIDER`:

1. **Gemini** (API do Google, SDK oficial `@google/genai`).
2. **Ollama** local (opcional; foi lento no hardware do dono).
3. **Determinístico** (sempre disponível, modelo de relatório por template).

Regras:

- Envia-se ao provider apenas o resumo estruturado e já sanitizado. Nunca `.env`, credenciais, tokens, e-mails, UIDs, códigos de sala, URLs, payloads de rede, traces, vídeos ou screenshots brutas.
- A chave do Gemini fica só em variável de ambiente do processo do worker. Nunca em prefixo `VITE_`, nunca no navegador, nunca no repositório.
- Saída estruturada em JSON, validada em tempo de execução antes de aparecer na UI.
- Tempo limite, uma nova tentativa para erros transitórios, tratamento claro de 401/403, 429, cota esgotada e modelo inexistente.
- Qualquer falha cai no provider seguinte e, no fim, no determinístico.
- Limites por execução e por dia, configuráveis.
- O modelo nunca escolhe ferramentas, parâmetros, seletores, ações do navegador nem ações do GitHub.

Sobre cotas: os limites do Gemini valem por projeto, não por chave, então criar várias chaves não multiplica a cota. Na captura do AI Studio do dono (6 de outubro de 2026), os limites gratuitos variavam muito entre modelos; por exemplo, um modelo "Flash" aparecia com apenas dezenas de requisições por dia e um modelo "Flash Lite" com centenas. A documentação do Google também indicou a aposentadoria do Gemini 2.5 Flash-Lite em 20 de outubro de 2026 na plataforma empresarial. **Reverificar nomes e cotas dos modelos no dia da implementação** e deixar o modelo configurável por `GEMINI_MODEL`, sem nome fixo no código.

Escolha inicial sugerida: um modelo leve de texto para classificação e relatórios curtos; um modelo maior só sob demanda. Não usar visão (análise de imagem) na primeira versão.

## 15. Escritório (UI)

O design foi feito no Claude Design e aprovado visualmente em quatro telas: escritório ao vivo, editor de layout, estado offline e o componente do mundo.

Direção visual:

- Pixel art simples, em vista oblíqua com profundidade e personagens legíveis.
- Quatro agentes, cada um com cor própria, mesa e monitor.
- Tema inicial "Warm Western Workshop" (oficina de faroeste). Temas previstos: "Desert Research Outpost" e "Night Operations Room".
- Arte original. Sem assets, personagens ou identidade de jogos existentes.
- Painéis laterais: lista de agentes à esquerda, detalhes do agente selecionado à direita, barra de zoom e câmera sob o mundo.

Comportamento:

- Modo **ao vivo**: agentes só mudam de pose por evento real. Sem caminhar aleatório, sem digitar falso, sem passagem de tarefa inventada.
- Modo **demo**: separado, carregado sob demanda, com faixa permanente "DEMO". Nunca se mistura ao estado ao vivo.
- Modo **offline**: mostra o escritório apagado e explica como conectar o worker.
- Informação crítica existe também em painéis DOM, nunca só dentro do canvas. A lista de agentes controla a mesma seleção e tem suporte a teclado.
- Respeitar `prefers-reduced-motion`.

Editor de layout:

- Ferramentas: selecionar, mover, colocar, apagar, rotacionar, recolorir, atribuir agente, atribuir estação, desfazer, refazer, salvar, restaurar, exportar e importar.
- O editor muda **somente a aparência**. Ele não altera permissões, credenciais, lógica de jogo ou regras de segurança, e a interface diz isso explicitamente.
- Persistência: `localStorage` com versão de schema e gancho de migração.
- Importação: JSON validado com limite de tamanho (64 KB) e de grade (64×64), identificadores de ativos de uma lista permitida, rótulos sanitizados, rejeição de `__proto__` e chaves desconhecidas. Importação inválida volta ao padrão com mensagem.
- Sem upload de PNG personalizado nesta fase; apenas variantes e paletas.

Telas dos monitores (ordem de entrega):

1. Texto derivado de eventos, com limite de linhas e caracteres, passando pelo sanitizador.
2. Screenshots derivadas e aprovadas, reduzidas e pixeladas, apenas de telas de uma lista permitida.
3. Telas com dado pessoal (login, perfil, amigos, lobby privado, código de sala) sempre mostram um marcador "dados pessoais ocultos", desenhado como estado intencional e não como erro.

Transmissão ao vivo da tela do agente fica fora do escopo inicial e exigirá issue e revisão de segurança próprias.

## 16. Segurança e privacidade

O repositório é público desde o primeiro commit. Isso define a política inteira:

1. Segredos (chaves, tokens, contas de teste) vivem apenas em *secrets* do repositório ou do ambiente e em `.env` locais. Nunca em código, docs, testes ou fixtures.
2. Workers imprimem apenas contagens e IDs opacos. Nunca texto de página, URLs, e-mails, tokens, códigos de sala ou payloads.
3. Traces, vídeos e screenshots brutas nunca sobem como artefatos e nunca vão para um provider de IA.
4. O sanitizador roda no worker, e cada resposta da API é montada campo a campo a partir de dados validados, sem repassar JSON bruto.
5. A UI renderiza texto como `textContent` e valida todo payload em tempo de execução. Política de segurança de conteúdo restritiva (`default-src 'none'` com exceções mínimas).
6. Alvos de teste vêm só da lista permitida do manifest; produção é sempre bloqueada.
7. Hugents nunca compartilha projeto Firebase com a aplicação testada e nunca guarda credenciais de produção de um projeto testado.
8. Uma bateria de testes de vazamento planta e-mail, token, código de sala e URL falsos e verifica que nenhuma saída os contém, em todo endpoint e em todo log do worker.
9. Texto de IA e texto de chat são dados não confiáveis, nunca instruções.
10. Relato de vulnerabilidades pelo recurso de relatório privado do GitHub.

Risco residual conhecido: nomes de jogadores e avatares dentro dos pixels de screenshots. A lista de telas ocultas cobre isso por enquanto.

## 17. Infraestrutura e limites de custo

Fatos pesquisados em 7 de outubro de 2026. Reverificar antes de depender deles.

| Recurso | Situação | Consequência |
|---|---|---|
| Oracle Always Free, VM Micro (1 OCPU, 1 GB) | Disponível, mas pequena | Serve para API leve e banco; **não comporta Playwright** com duas sessões |
| Oracle Always Free, Ampere A1 | Cota reduzida para 2 OCPU/12 GB desde 15 de junho de 2026 | Comporta Playwright, mas depende de capacidade da região |
| Oracle, instâncias ociosas | Podem ser recuperadas se CPU, rede e memória ficarem abaixo de 20% por 7 dias | Risco para um sistema de uso esporádico |
| Vercel Hobby | Funções com limite de 250 MB descompactadas e duração padrão de 300 s; plano pessoal e não comercial | Bom para hospedar a UI; ruim para Playwright com duas sessões |
| Render, Koyeb e Fly.io (gratuitos) | Memória e CPU muito baixas, ou sem cota gratuita | Não servem para Playwright |
| GitHub Actions | Gratuito em repositório público; 2.000 min/mês em privado | Melhor opção gratuita de nuvem para o worker |
| Firebase Spark | Cotas diárias do Firestore | Viável com snapshot público |

Por isso a arquitetura combina: UI estática no portfólio, Firebase como backend, worker local e worker opcional no GitHub Actions.

## 18. Primeiro adapter: Big Bang Duel

O jogo é o primeiro projeto do manifest. Regras que valem para ele e que o adapter deve carregar:

- Alvo: apenas o ambiente de Preview da Vercel, que usa o projeto Firebase de QA do jogo. Produção é bloqueada.
- Autenticação: contas de QA e o login de desenvolvimento exclusivo do Preview, sempre por variáveis de ambiente locais.
- Fluxo: sala privada por código. Quick Match, salas públicas e desafio de amigos (issue #30, ainda incompleta) ficam fora.
- Acesso sempre pela interface visível. Nada de chamadas diretas ao Firebase, RTDB, Firestore ou Admin SDK.
- URL do Preview: variável local `GAME_BASE_URL`, atualizada por `agent:sync-preview`. O manifest guarda só o nome da variável, nunca a URL.
- Telas sempre ocultadas: login, lobby privado, perfil, amigos.
- Os repositórios do jogo e do Hugents não se misturam. Nada do código do jogo, de seletores reais ou de dados de contas entra no repositório público do Hugents.

## 19. Migração do protótipo

1. Congelar o protótipo no repositório do jogo (sem apagar o vendor ainda).
2. Extrair para `packages/core`: contrato de eventos, sanitizador, interface de providers e interface `Store`.
3. Reescrever o manifest do jogo como primeiro adapter.
4. Portar o runner de partida privada como cenário em `packages/scenarios`, mantendo os testes e a política de segurança.
5. Portar o observer e o `findings.json`.
6. Construir o escritório novo e ligar ao backend.
7. Somente depois da paridade mínima, remover do repositório do jogo o protótipo, o patch do AgentOffice e as dependências relacionadas.

Descartados do protótipo, por quebrarem o princípio de não simular atividade: o chat do AgentOffice de terceiros, o grafo de relações, os botões de "caos", a memória em SQLite com embeddings e qualquer execução de código arbitrário.

## 20. Roadmap

| Fase | Entrega | Critério de aceite |
|---|---|---|
| 0 | Scaffold do repositório e política de segurança (PR #1) | `LICENSE` restaurado; configurações de segurança ativadas |
| 1 | Extração do contrato de eventos, sanitizador, providers e `Store` | Testes de vazamento passam; nada do jogo copiado |
| 2 | Manifest e primeiro adapter | Produção rejeitada antes de qualquer ação |
| 3 | Core local com emulador do Firestore | Fila, eventos e estado `waiting` corretos |
| 4 | Worker local com Playwright | Partida privada completa por cenário |
| 5 | Regras do Firestore, login admin e visão pública | Testes de acesso permitido e negado |
| 6 | Escritório | Sem evento, sem atividade; demo e offline separados |
| 7 | Worker no GitHub Actions | Teste que falha se algo sensível aparecer no log |
| 8 | Criador de testes | Rascunhos só entram após aprovação |

A ordem importa. A fase 4 deve funcionar no computador do dono antes de qualquer workflow existir em um repositório público.

## 21. Riscos

| Risco | Impacto | Mitigação |
|---|---|---|
| Vazamento por log ou artefato em repositório público | Alto | Política da seção 16, teste de vazamento, nenhum artefato |
| Cota do Firestore esgotada por visitantes | Médio | Snapshot público, cache, contadores agregados |
| Mudança nos planos gratuitos (Oracle, Vercel, Gemini) | Médio | Interface `Store`, providers intercambiáveis, reverificação documentada |
| Modelo do Gemini aposentado ou cota reduzida | Médio | `GEMINI_MODEL` configurável, fallback determinístico |
| Preview público sem proteção da Vercel | Médio | Revisar depois (token de bypass ou alias controlado); contas de QA isoladas |
| Injeção de prompt via artefatos ou chat | Médio | Texto como dado, comandos em lista fechada, saída validada |
| Estratégia espelhada dos jogadores de teste | Baixo | Políticas distintas e reproduzíveis em fase futura |
| Qualidade visual depende da arte | Médio | Aprovar o visual antes de construir o resto |

## 22. Configurações manuais do dono

Nada disso é feito pelo código do repositório:

1. Criar o projeto Firebase `hugents` (Authentication e Firestore) e uma conta de serviço restrita ao worker.
2. No repositório: ativar relato privado de vulnerabilidades, alertas do Dependabot, varredura de segredos com bloqueio de push.
3. Proteger a branch `main` com PR obrigatória e revisão de code owners.
4. Em Actions: exigir aprovação para workflows de colaboradores externos, token padrão somente leitura e workflows desativados até a fase 7.
5. Restaurar o `LICENSE` na PR #1.
6. Definir as variáveis locais do worker (`GEMINI_API_KEY`, `FIREBASE_PROJECT_ID`, token do worker e variáveis das contas de teste) em `.env` ignorado pelo Git.
7. Decidir as questões em aberto da seção 5.

---

## Apêndice A. Variáveis de ambiente (apenas nomes)

| Variável | Uso |
|---|---|
| `AI_PROVIDER` | `gemini`, `ollama` ou `deterministic` |
| `GEMINI_ENABLED`, `GEMINI_API_KEY`, `GEMINI_MODEL` | Provider Gemini |
| `OLLAMA_BASE_URL`, `OLLAMA_MODEL` | Provider Ollama opcional |
| `FIREBASE_PROJECT_ID` e demais identificadores públicos do app | Conexão com o Firebase do Hugents |
| `HUGENTS_WORKER_TOKEN` | Autenticação do worker |
| `OFFICE_CONTROL` | Habilita criar tarefas e enviar mensagens; padrão desligado |
| `OFFICE_SCREENS` | `off`, `placeholder` ou `approved`; padrão `placeholder` |
| `QA_TRACE_ENABLED`, `QA_VIDEO_ENABLED` | Padrão `false` |
| `QA_ARTIFACT_MAX_BYTES`, `QA_ARTIFACT_KEEP_RECENT_RUNS`, `QA_ARTIFACT_KEEP_FAILURE_RUNS` | Retenção local |
| Nomes das variáveis das contas de teste | Definidos por projeto no manifest |

Nenhum segredo usa prefixo de variável pública do cliente.

## Apêndice B. Perguntas que ainda precisam de resposta do dono

1. Three.js ou Canvas 2D para o mundo visual?
2. Qual método de login do admin (passkey, TOTP ou Google com MFA)?
3. O worker do GitHub Actions entra na primeira versão ou só o worker local?
4. Haverá quadros além do quadro de tarefas (findings, avisos)?
5. O repositório de execução do worker será o mesmo público ou um privado separado?
