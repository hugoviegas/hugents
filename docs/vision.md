# Visão do Hugents (rascunho vivo)

Documento organizado em conversa com o Hugo. Complementa `hugents-project-spec.md` (especificação técnica) e será atualizado conforme a conversa avança. Status: v1 consolidada em 7 de outubro de 2026, base para a sessão de ajustes do MVP.

## O problema

Hoje o Hugo faz o ciclo inteiro sozinho: elabora a ideia, define o escopo, manda o Claude desenvolver, testa, analisa as páginas e pensa em melhorias. Ele é o gargalo.

## A ideia central

Uma equipe de agentes de IA, cada um com uma função, que entra no projeto, testa tudo e devolve ao Hugo uma lista pronta do que precisa ser feito e corrigido. O objetivo de todo o trabalho dos agentes é melhorar a UX.

## Como funciona (ciclo)

1. O agente lê o código antes de testar, para não adivinhar o que existe.
2. Recebe uma tarefa com objetivo claro (ex.: "analisar a página Missões") e um arquivo de execução de teste completo.
3. Percorre as telas, clica, tira prints e gera logs.
4. A IA analisa logs e imagens e tira as próprias conclusões.
5. Pode repetir o teste uma vez para reconferir pontos antes de marcar a tarefa como feita.
6. Escreve o relatório e propõe ao agente de issues o que fazer.
7. O agente de issues reúne os relatórios e cria a issue no GitHub.
8. O Hugo lê, resolve (com o Claude), abre a PR e designa o agente que testou para revalidar.
9. O agente só volta a trabalhar quando alguém lança uma atualização na tarefa dele.

## Papéis de agentes

| Agente | Função |
|---|---|
| Testador de páginas | Recebe uma página/tarefa, executa o roteiro, tira prints, analisa e reporta |
| Testador de botões | Clica em todos os botões e verifica se funcionam |
| Revisor de tradução | Confere textos e idiomas |
| Jogadores (dois) | Jogam entre si, testam combinações novas e cumprem missões |
| Especialista em Playwright | Ajusta os testes para variar interações e evitar loops repetidos |
| Designer (um ou dois) | Analisa screenshots de cada página, anota melhorias num bloco de notas `.md` e envia ao processo quando houver volume razoável |
| Agente de issues | Consolida relatórios e gera as issues |
| **Construtor de testes (lê o código)** | **Prioridade máxima.** Lê o código do projeto e monta/atualiza os roteiros de Playwright que os demais agentes executam |
| Analista de PRs | Lê PRs novas e atualizações (a descrição que o Hugo escreve é a fonte principal), entende o que foi construído e prepara o plano de teste. Não executa nada sozinho |
| Aprimorador de skills | Melhora as skills dos agentes e busca skills novas |
| Diretor | Distribui tarefas entre os agentes, junto com o Hugo |

Não haverá agentes de desenvolvimento: o código continua sendo feito pelo Claude, o que deixa o sistema mais barato e simples.

## A "sala" (interface)

- Sala de agentes funcionais (o escritório já previsto).
- Salas/quadros de **ideias, melhorias e correções**.
- Mural com o **board de issues** do GitHub.
- Mural de **PRs**.

## Operação

- Agentes rodando 24h, mas limitados por tarefa (orçamento por agente/tarefa).
- Um agente fica parado até haver uma atualização na tarefa dele.

## Princípios já definidos (do repositório)

Gratuito, local primeiro, verdadeiro (a UI nunca mostra o que não aconteceu), sanitizado por padrão, independente de projeto via manifest, aprovação humana antes de escrever em sistema de terceiros.

## O que a issue #93 do Big Bang Duel já decidiu

Lida em 7/10/2026 (repositório do jogo, só leitura). Ela é a "issue-mãe" do protótipo e já cobre parte desta visão:

- Papéis já previstos na Fase 4: Player, Explorer, QA Analyst, Design Critic, Triage Manager, Issue Writer e Skill Coach. Eles casam quase 1 para 1 com a tabela de agentes acima. Novidades da conversa: o revisor de tradução, o especialista em Playwright e o ciclo "agente só volta quando a tarefa recebe atualização".
- Já existe: runner determinístico com dois jogadores (Alpha e Bravo), partida privada completa e eventos JSONL. Falta: observador e findings (#96), agentes especializados, IA com cotas, issues automáticas, escritório público, agendamento.
- Só usa o ambiente Preview com Firebase de QA, nunca produção, e só interage pela UI visível.
- IA entra depois da coleta determinística e precisa degradar bem quando a cota acaba. Skill Coach só sugere, não altera nada sozinho.
- Issues no GitHub: duplicatas checadas, limite diário, rótulos existentes, texto em inglês e aprovação humana antes de cada escrita.
- Conflito com a nova ideia: a issue diz "não rodar loops 24/7 ilimitados; começar com agenda limitada". O Hugo disse "24h, limitado por tarefas". Parece compatível se "24h" significar agenda contínua com orçamento por tarefa e kill switch.

## Análise dos reports atuais (7/10/2026, 4 reports)

Fonte: `packages/duel-agent-office/artifacts/reports` e `artifacts/office`. Duas execuções: `private-match-full-game` e `explore-screens`.

**O que deu certo**
- Partida privada completa: 8 turnos por jogador, sem erro de console. Duas requisições `ERR_ABORTED` ignoradas por padrão.
- Exploração das 9 telas sem falha de navegação, 11 screenshots aprovadas, 0 erros de console e de rede.
- Achado real: a tela **Missões** mostra chaves de tradução cruas (`TABS.DAILY`, `TABS.WEEKLY`, `TABS.MONTHLY`, `DIFFICULTY.MEDIUM`, `DIFFICULTY.EASY`). Explorer e QA Analyst chegaram nele.
- Cotas controladas: 4 chamadas ao Gemini no dia (flash-lite), cerca de 540 a 640 tokens por report.

**O que precisa consertar**
1. **Observer e Explorer discordam.** O observer diz "no findings" nos mesmos reports em que o Explorer achou as chaves cruas. A regra de chaves de tradução não está no observer determinístico.
2. **Severidade inconsistente:** o mesmo problema saiu `low` (Explorer) e `medium` (QA Analyst). Falta critério único.
3. **Design Critic não analisou nada.** Saiu só uma checklist com a lista dos arquivos, e o próprio report diz "no vision model, screenshots not analysed". O Gemini foi pulado por "budget-run".
4. **Analista e Critic não geram evidência nova.** Rodaram sobre o mesmo run do Explorer, e o Explorer recebeu a tarefa "read alpha report". Hoje as tarefas são texto livre e o comportamento é padrão por agente, sem objetivo específico.
5. **Provável que o Gemini só receba texto.** Tokens baixos sugerem resumo textual, não imagens (inferência, não verificada no código).
6. **Reports com duas partes duplicadas:** resumo do modelo em cima e gabarito determinístico embaixo, com a mesma evidência repetida.
7. **Sem report do Bravo.** Só existe `player-alpha`. Os dois jogadores seguem como uma sessão com duas contas e terminaram empatados (mesma política).
8. **Explorer só olha com a conta Alpha** e só abre telas (não clica em botões dentro delas).
9. **Sem organização por data.** Os reports são arquivos soltos na mesma pasta; a única data está no nome do arquivo.

## MVP: funcionalidades pedidas

Design do escritório já está razoável (Hugo, 7/10). Falta o funcional:

1. **Reports finais organizados por data**, no escritório, por agente, com filtro por agente/tarefa/severidade.
2. **Configuração de agentes** (hoje são só comandos com tarefas padrão): objetivo, skill, limite de cota e escopo por agente.
3. **Agente de testes planejado para rodar** com roteiro e objetivo definidos (não texto livre solto).
4. **Conector com o GitHub** para acessar repositórios locais e os do próprio GitHub (leitura primeiro; escrita só com aprovação).
5. **Algo para encerrar o Playwright que está rodando** (parar/derrubar a sessão em andamento). Confirmar com o Hugo se é um botão de parar rodada ou uma limpeza de processos presos.
6. **Agente de planejamento de testes:** o Hugo diz o que precisa; ele lê o código do jogo, descobre o que é necessário para executar a tarefa e escreve um report de como montar o ambiente de testes para o runner executar.
7. **Sessões separadas dos jogadores:** dois agentes independentes (Alpha e Bravo), cada um com seu comando, seu objetivo e seu report, em vez de um agente rodando duas contas.

## Decisões tomadas nesta conversa

- **Gemini analisa imagens e logs.** A spec antiga ("screenshots brutas nunca saem do worker") está errada neste ponto e deve ser revisada. Condição: respeitar os limites do plano grátis, alternando entre modelos. Valores informados pelo Hugo: cerca de 500 requisições por dia, 15 por minuto e 250 mil tokens por minuto por modelo. Reverificar antes de depender, porque limites grátis mudam. Ainda a definir: mascaramento de dados sensíveis nos prints antes do envio.
- **Origem das tarefas:** vêm do Hugo ou do agente Diretor.
- **Cada agente tem skill própria.** O Aprimorador de skills evolui as existentes e procura novas (sugere, não aplica sozinho: ver #93).
- **Prioridade máxima:** o Construtor de testes, que lê o código e gera os roteiros de Playwright para os outros agentes, em vez de testar às cegas.
- **Fluxo disparado por PR:** o Analista de PRs lê a PR e a descrição, o Construtor de testes prepara/atualiza o roteiro, e os agentes de teste só rodam depois de um **comando explícito do Hugo**, para não gastarem cota nem fazerem testes desnecessários. Escopo de cada rodada: apenas o que a PR tocou (mais um conjunto mínimo de regressão, a definir).

- **Como dar ordens (três canais):**
  1. **Escritório (principal):** o Hugo vê o escritório e dá ordens a cada agente, por chat/sessão com o agente. O agente executa e devolve o que foi feito. Cada agente tem tarefas programadas e comandos próprios.
  2. **Terminal/CLI:** comandos diretos, para executar sem conversa.
  3. **GitHub Actions (quando hospedado):** mencionar o agente na PR (ex.: um comentário) dispara a rodada. Só quem tem permissão pode acionar.
  No modo local, o chat com o agente é o caminho mais fácil. O que o Hugo mais quer é **ver o escritório e dar as ordens por ele**.

- **Dois modos de comando no escritório (os dois existem):**
  - **Comandos prontos:** lista programada no sistema, sem custo de IA, previsível.
  - **Chat livre:** o Gemini interpreta a mensagem antes (gasta cota) e a converte em uma ação de uma lista fechada, ou em instruções extras para a tarefa do agente. Serve para explicar algo fora dos comandos existentes.
  Proposta (a confirmar): comandos prontos para o dia a dia e chat livre quando precisar; o chat mostra ao Hugo o que entendeu e pede confirmação antes de executar.

- Agentes de desenvolvimento continuam fora: quem desenvolve é o Claude.

## Pontos de tensão a decidir

1. A spec diz "IA só interpreta e redige; nunca escolhe ferramentas". A nova visão deixa a IA sugerir testes e conclusões, e o Diretor distribuir tarefas. Onde fica o limite (lista fechada de ações)?
2. ~~Screenshots nunca saem do worker~~: resolvido, o Hugo quer usar o Gemini nas imagens. Falta definir o que mascarar antes de enviar e o que acontece quando a cota acaba (a #93 pede degradar para coleta determinística).
3. "24h" versus "gratuito e local": o PC do Hugo fica ligado? Entra o GitHub Actions? Quais limites de tarefa?
4. A spec exige aprovação humana para escrever no GitHub. O agente de issues cria issues sozinho ou propõe e o Hugo aprova?
5. Dois jogadores jogando é específico do Big Bang Duel: vira um tipo de agente genérico via manifest?

## Fica para depois

- Escritório público somente leitura (Fase 6 da #93) e agendamento contínuo com kill switch (Fase 7).
- Criação automática de issues no GitHub (primeiro apenas rascunho local; escrita só com aprovação do Hugo).
- Agentes de IA para desenvolvimento: fora de escopo, o Claude faz o código.
- Escolha da tecnologia do mundo visual (Canvas 2D ou 3D): o design atual do escritório já está aprovado.

## Perguntas ainda em aberto

1. ~~"Tirar o Playwright que está rodando": botão para parar a rodada em andamento, ou limpeza de processos presos?~~ Resolvido em 7/10/2026: os dois (Parar rodada no agente e limpeza dos processos presos que o escritório iniciou).
2. Chat livre dos agentes: confirmar que sempre mostra o que entendeu e pede confirmação antes de executar.
3. Regeneração de roteiros após uma PR: automática ou com aprovação do Hugo antes de valer.
4. Quais dados mascarar nos prints antes de enviar ao Gemini, e o que fazer quando a cota acabar.
5. Conjunto mínimo de regressão que roda junto com o escopo da PR.
