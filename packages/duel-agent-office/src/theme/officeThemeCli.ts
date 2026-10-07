import { writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { officeThemeCss } from "./office.js";

// Writes the AgentOffice stylesheet from the design tokens. `npm run office:setup` copies it into the vendored UI.
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const target = path.join(ROOT, "office", "theme", "agent-office.css");
await writeFile(target, officeThemeCss(), "utf8");
console.log("Wrote office/theme/agent-office.css");
