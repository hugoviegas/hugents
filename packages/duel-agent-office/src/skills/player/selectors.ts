/**
 * Selector inventory. VERIFIED entries were read from the app source on `main`
 * (PT-BR source locale, the runner forces locale pt-BR). Anything not listed
 * here is UNVERIFIED and must not be guessed: the scenario blocks instead.
 */
export const VERIFIED = {
  login: {
    // duelo/src/components/auth/LoginScreen.tsx: <label><span>Email</span><input type="email">
    email: { label: "Email" },
    password: { label: "Senha" },
    // Exact name so "Entrar com Google" and "Ja tenho conta. Entrar." do not match.
    submit: { role: "button", name: "Entrar" },
    error: { role: "alert" },
  },
  devLogin: {
    // duelo/src/features/devLogin/DevLoginPanel.tsx (mounted by LoginScreen when enabled)
    secret: { label: "Segredo do dev login" },
    loadAccounts: { role: "button", name: "Carregar contas" },
    signInAs: (name: string) => ({ role: "button", name: `Entrar como ${name}` }) as const,
  },
  routes: { menu: /\/menu(?:$|[/?#])/, lobby: "/online" },
  lobby: {
    // duelo/src/features/lobby/OnlineLobby.tsx (Tabs.tsx: role=tab; panels: #lobby-panel-<tab>)
    createTab: { role: "tab", name: "Criar" },
    joinTab: { role: "tab", name: "Entrar" },
    createPanel: "#lobby-panel-create",
    joinPanel: "#lobby-panel-join",
    // Switch.tsx: role=switch + aria-checked. Default false = private room.
    publicSwitch: { role: "switch", name: "Sala pública" },
    createButton: { role: "button", name: "Criar sala" },
    joinCodeInput: { label: "Código da sala" },
    joinButton: { role: "button", name: "Entrar na sala" },
    error: { role: "alert" },
  },
  waitingRoom: {
    // duelo/src/features/battle/WaitingRoomOverlay.tsx, mounted by components/game/GameArena.tsx
    heading: { role: "heading", name: "Aguardando forasteiro" },
    // The code is the <span> that follows this label <span>.
    codeLabel: "Código da sala",
    cancel: { role: "button", name: "Cancelar e voltar ao menu" },
  },
  battle: {
    // duelo/src/features/battle/Hand.tsx and BattleCard.tsx
    hand: { role: "region", name: "Sua mão" },
    cardGroup: { role: "group", name: "Cartas" },
    // aria-pressed="true" = selected; aria-disabled="true" = no ammo / no uses / dodge streak
    cardButtons: "button[aria-pressed]",
    confirm: { role: "button", name: "Confirmar" },
    // duelo/src/features/battle/BattleHud.tsx: two ammo indicators, own side first.
    // Hidden opponent ammo renders a different label, so only one match exists then.
    ammo: { role: "img", name: /^\d+ de \d+ balas$/ },
    // BattleHud.tsx TimerBar: rendered only while a card can be chosen ("N segundos para escolher")
    turnTimer: { role: "timer" },
    // duelo/src/features/battle/TurnResultOverlay.tsx: "Turno N: <narrative>"
    resultReveal: { role: "status", name: /^Turno \d+:/ },
    // duelo/src/ui/Dialog.tsx: any modal dialog (leave confirmation, welcome dialogs)
    dialog: '[role="dialog"]',
    // duelo/src/features/battle/GameOverScreen.tsx
    gameOverTitle: "#game-over-title",
    outcomes: { "Vitória!": "win", "Derrota!": "loss", "Empate!": "draw" } as const,
  },
} as const;

/**
 * Not used by the room-code flow. `friendChallenge` is a future scenario: issue #30 is
 * open and FriendsScreen "Convidar" only navigates to the lobby, so no challenge UI exists.
 * `roomFailureBanner`: no dedicated element found; a failed room ends via the scenario timeout.
 */
export const UNVERIFIED = {
  friendChallenge: null,
  roomFailureBanner: null,
} as const;
