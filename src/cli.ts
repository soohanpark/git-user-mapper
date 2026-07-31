import { Command } from "commander";
import { runAdd } from "./commands/add.ts";
import { runDefault } from "./commands/default.ts";
import { runList } from "./commands/list.ts";
import { runMap } from "./commands/map.ts";
import { runRemove } from "./commands/remove.ts";
import { runReset } from "./commands/reset.ts";
import { runShellInit } from "./commands/shellInit.ts";
import { runStatus } from "./commands/status.ts";
import { runSync } from "./commands/sync.ts";
import { runUnmap } from "./commands/unmap.ts";

export const run = async (argv: readonly string[]): Promise<void> => {
  const program = new Command();

  program.name("git-mapper").description("Map directories to git identities").version("1.0.0");

  program
    .command("map", { isDefault: true })
    .description("Map the current directory to a profile")
    .action(runMap);

  program
    .command("status")
    .description("Show the profile that applies here and verify it against git")
    .option("--porcelain", "machine readable output for shell prompts", false)
    .action(async (options: { porcelain: boolean }) => {
      process.exitCode = await runStatus({ porcelain: options.porcelain });
    });

  program.command("list").description("List profiles and their mappings").action(runList);

  program.command("add").description("Add a profile").action(runAdd);

  program
    .command("remove")
    .argument("[id]", "profile id")
    .description("Remove a profile and its mappings")
    .action(async (id?: string) => {
      await runRemove(id);
    });

  program
    .command("unmap")
    .argument("[path]", "directory to unmap (defaults to the current directory)")
    .description("Remove a directory mapping")
    .action(async (target?: string) => {
      await runUnmap(target);
    });

  program
    .command("default")
    .argument("[id]", "profile id")
    .description("Set the fallback profile used where no mapping matches")
    .action(async (id?: string) => {
      await runDefault(id);
    });

  program
    .command("sync")
    .option("--dry-run", "print what would change without changing anything", false)
    .description("Regenerate every derived file")
    .action(async (options: { dryRun: boolean }) => {
      await runSync({ dryRun: options.dryRun });
    });

  program
    .command("shell-init")
    .argument("<shell>", "zsh, bash or fish")
    .description("Print the shell snippet that shows the active profile in your prompt")
    .action(async (shell: string) => {
      await runShellInit(shell);
    });

  program.command("reset").description("Remove all profiles and mappings").action(runReset);

  await program.parseAsync([...argv]);
};
