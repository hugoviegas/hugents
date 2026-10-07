import path from "node:path";
import type { Browser, BrowserContext, Page } from "playwright";
import { BlockedError } from "../errors.js";
import type { Config } from "../config.js";
import { checkPreviewTarget } from "../config.js";
import { VERIFIED } from "../skills/player/selectors.js";
import type { EventBus } from "../orchestrator/eventBus.js";
import { relativeArtifactPath, type RunPaths } from "../storage/artifacts.js";

export type PlayerAgent = "player-alpha" | "player-bravo";

const LOGIN_TIMEOUT_MS = 30_000;
const EMAIL_TEXT = /[\w.+-]+@[\w-]+\.[\w.-]+/;

/** One isolated QA player: own browser, own context, own page, own evidence folder. */
export class PlayerSession {
  private shots = 0;
  private tracing = false;

  constructor(
    readonly agent: PlayerAgent,
    readonly browser: Browser,
    readonly context: BrowserContext,
    readonly page: Page,
    readonly dir: string,
    private readonly run: RunPaths,
    private readonly bus: EventBus,
    private readonly config: Config,
  ) {}

  private get credentials() {
    return this.agent === "player-alpha" ? this.config.players.alpha : this.config.players.bravo;
  }

  /** The page must stay on the configured Preview origin; anything else stops the run. */
  assertTarget(): void {
    const url = this.page.url();
    if (url === "about:blank") return;
    if (checkPreviewTarget(url) !== null || new URL(url).origin !== this.config.baseUrl) {
      throw new BlockedError("target-guard", "Page left the configured Preview origin");
    }
  }

  async screenshot(name: string): Promise<string> {
    this.shots += 1;
    const file = path.join(this.dir, `${String(this.shots).padStart(2, "0")}-${name}.png`);
    // Any element whose text holds an e-mail address (profile, settings) is masked in every screenshot.
    await this.page.screenshot({ path: file, mask: [this.page.getByText(EMAIL_TEXT)] });
    return relativeArtifactPath(this.run, file);
  }

  /** Emits a `working` event and, when enabled, a screenshot for a meaningful step. */
  async step(name: string, activity: string): Promise<void> {
    const shot = this.config.screenshotOnStep ? await this.screenshot(name) : undefined;
    await this.bus.emit(this.agent, "working", activity, shot);
  }

  /**
   * True unless the page currently shows something a screenshot must not capture:
   * the login form (a typed e-mail), the Dev Login secret field, the join-code field
   * or the waiting room (which displays the room code).
   */
  async isSafeToCapture(): Promise<boolean> {
    const surfaces = [
      this.page.getByLabel(VERIFIED.login.email.label, { exact: true }),
      this.page.getByLabel(VERIFIED.devLogin.secret.label, { exact: true }),
      this.page.getByLabel(VERIFIED.lobby.joinCodeInput.label, { exact: true }),
      this.page.getByRole(VERIFIED.waitingRoom.heading.role, { name: VERIFIED.waitingRoom.heading.name }),
    ];
    try {
      for (const surface of surfaces) {
        if (await surface.first().isVisible()) return false;
      }
      return true;
    } catch {
      return false;
    }
  }

  /** One best-effort evidence screenshot after a failure; skipped on sensitive surfaces. Never throws. */
  async failureScreenshot(): Promise<{ path?: string; skipped?: boolean }> {
    try {
      if (!(await this.isSafeToCapture())) return { skipped: true };
      return { path: await this.screenshot("failure") };
    } catch {
      return {};
    }
  }

  async login(): Promise<void> {
    await this.bus.emit(this.agent, "working", "Opening Preview and logging in");
    await this.page.goto(this.config.baseUrl, { waitUntil: "domcontentloaded" });
    this.assertTarget();
    // Screenshot before any credential is typed so no e-mail is ever captured.
    await this.step("login-screen", "Login screen visible");

    if (this.config.devLogin.enabled) await this.devLogin();
    else await this.emailLogin();

    await this.page.waitForURL(VERIFIED.routes.menu, { timeout: LOGIN_TIMEOUT_MS });
    this.assertTarget();
    await this.startTracing();
    await this.step("logged-in", "Logged in, menu visible");
  }

  private async emailLogin(): Promise<void> {
    const { email, password } = this.credentials;
    const l = VERIFIED.login;
    await this.page.getByLabel(l.email.label, { exact: true }).fill(email);
    await this.page.getByLabel(l.password.label, { exact: true }).fill(password);
    await this.page.getByRole(l.submit.role, { name: l.submit.name, exact: true }).click();
    await this.failOnLoginError();
  }

  private async devLogin(): Promise<void> {
    const d = VERIFIED.devLogin;
    await this.page.getByLabel(d.secret.label, { exact: true }).fill(this.config.devLogin.secret);
    await this.page.getByRole(d.loadAccounts.role, { name: d.loadAccounts.name, exact: true }).click();
    const target = d.signInAs(this.credentials.devLoginName);
    await this.page.getByRole(target.role, { name: target.name, exact: true }).click();
    await this.failOnLoginError();
  }

  /** Surfaces the visible login error (if any) without echoing its text. */
  private async failOnLoginError(): Promise<void> {
    const alert = this.page.getByRole(VERIFIED.login.error.role);
    const appeared = await alert
      .first()
      .waitFor({ state: "visible", timeout: 3_000 })
      .then(() => true)
      .catch(() => false);
    if (appeared && !VERIFIED.routes.menu.test(this.page.url())) {
      throw new Error("Login rejected: the login screen shows an error");
    }
  }

  /**
   * Opt-in only (QA_TRACE_ENABLED=true). Starts after login so typed credentials never
   * enter the trace. Traces are large and hold unredacted network data: keep them local.
   */
  private async startTracing(): Promise<void> {
    if (!this.config.traceEnabled) return;
    await this.context.tracing.start({ screenshots: true, snapshots: true, sources: false });
    this.tracing = true;
  }

  async close(): Promise<void> {
    if (this.tracing) {
      await this.context.tracing.stop({ path: path.join(this.dir, "trace.zip") }).catch(() => undefined);
      this.tracing = false;
    }
    await this.context.close().catch(() => undefined);
    await this.browser.close().catch(() => undefined);
  }
}
