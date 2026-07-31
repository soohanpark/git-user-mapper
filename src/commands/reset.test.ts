import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { getIncludeIf } from "../core/gitconfig/globalConfig.ts";
import { toAbsolutePath } from "../core/paths.ts";
import { type SyncOptions, applySync } from "../core/sync.ts";
import type { ProfileId, StoreV2 } from "../types.ts";
import { clearManaged } from "./reset.ts";

const id = (value: string): ProfileId => value as ProfileId;

test("clearManaged removes our includeIf entries and profile files but leaves [user]", async () => {
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "gum-reset-")));
  const globalConfigPath = path.join(base, ".gitconfig");
  fs.writeFileSync(globalConfigPath, "");
  const env = { GIT_CONFIG_GLOBAL: globalConfigPath, GIT_CONFIG_NOSYSTEM: "1" };
  const options: SyncOptions = {
    configDir: path.join(base, "config"),
    globalConfigPath,
    now: "t0",
    caseInsensitive: false,
    git: { env },
  };
  fs.mkdirSync(path.join(base, "personal"), { recursive: true });

  const store: StoreV2 = {
    version: 2,
    defaultProfile: id("work"),
    profiles: [
      { id: id("work"), name: "n", email: "w@x.com", signingKey: null, color: "blue", paths: [] },
      {
        id: id("personal"),
        name: "n",
        email: "m@x.com",
        signingKey: null,
        color: "magenta",
        paths: [toAbsolutePath(path.join(base, "personal"))],
      },
    ],
    managedConditions: [],
  };

  const synced = await applySync(store, options);
  const condition = synced.managedConditions[0] as string;
  assert.notEqual(await getIncludeIf(condition, { env }), null);

  await clearManaged(synced, options);

  assert.equal(await getIncludeIf(condition, { env }), null);
  assert.equal(fs.existsSync(path.join(options.configDir, "profiles", "personal.gitconfig")), false);
  assert.match(fs.readFileSync(globalConfigPath, "utf8"), /\[user\]/);
});
