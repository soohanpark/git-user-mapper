import { createRequire } from "node:module";
import { Command } from "commander";

/**
 * 명령 모듈은 실제로 부를 때 불러온다.
 *
 * 정적으로 열 개를 걸어 두면 `conf`·`zod`·`@inquirer/prompts`·`execa`·`chalk`까지
 * 전부 딸려 와서, 어떤 명령을 쓰든 475개 모듈을 읽고 시작한다. README가 권하는 대로
 * `eval "$(git-mapper shell-init zsh)"`를 `~/.zshrc`에 넣으면 그 값이 **새 터미널을 열
 * 때마다** 붙는다. 실측(빌드된 dist, 격리 HOME, 25회 인터리브)으로 `node -e ''`가
 * min 28.7ms인데 `shell-init zsh`는 min 191.8 / p50 347.3ms였고, 그중 우리 임포트
 * 그래프가 대부분이었다. `shell-init`이 실제로 필요로 하는 서드파티 의존성은 0개다.
 */
const load = {
  add: async () => (await import("./commands/add.ts")).runAdd,
  default: async () => (await import("./commands/default.ts")).runDefault,
  list: async () => (await import("./commands/list.ts")).runList,
  map: async () => (await import("./commands/map.ts")).runMap,
  remove: async () => (await import("./commands/remove.ts")).runRemove,
  reset: async () => (await import("./commands/reset.ts")).runReset,
  shellInit: async () => (await import("./commands/shellInit.ts")).runShellInit,
  status: async () => (await import("./commands/status.ts")).runStatus,
  sync: async () => (await import("./commands/sync.ts")).runSync,
  unmap: async () => (await import("./commands/unmap.ts")).runUnmap,
} as const;

/**
 * package.json에서 읽는다. 하드코딩하면 `npm version`이 올려도 그대로 남아
 * `git-mapper --version`이 영원히 옛 번호를 답한다.
 *
 * 소스에서는 `src/cli.ts`, 빌드 후에는 `dist/src/cli.js`라 상위 깊이가 한 칸 다르다.
 * 깊이를 고정하면 둘 중 하나가 반드시 틀리므로, 이름으로 맞는 파일을 확인한다.
 */
const version = (): string => {
  const require = createRequire(import.meta.url);
  for (const candidate of ["../package.json", "../../package.json"]) {
    try {
      const pkg = require(candidate) as { readonly name?: string; readonly version?: string };
      if (pkg.name === "git-user-mapper" && pkg.version !== undefined) return pkg.version;
    } catch {
      // 이 후보가 아니면 다음을 본다.
    }
  }
  throw new Error("could not locate package.json to read the version from");
};

export const run = async (argv: readonly string[]): Promise<void> => {
  const program = new Command();

  program
    .name("git-mapper")
    .description("Map directories to git identities")
    .version(version())
    .showSuggestionAfterError();

  program
    .command("map")
    .description("Map the current directory to a profile")
    .action(async () => {
      await (await load.map())();
    });

  program
    .command("status")
    .description("Show the profile that applies here and verify it against git")
    .option("--porcelain", "machine readable output for shell prompts", false)
    .action(async (options: { porcelain: boolean }) => {
      process.exitCode = await (await load.status())({ porcelain: options.porcelain });
    });

  program
    .command("list")
    .description("List profiles and their mappings")
    .action(async () => {
      await (await load.list())();
    });

  program
    .command("add")
    .description("Add a profile")
    .action(async () => {
      await (await load.add())();
    });

  program
    .command("remove")
    .argument("[id]", "profile id")
    .description("Remove a profile and its mappings")
    .action(async (id?: string) => {
      await (await load.remove())(id);
    });

  program
    .command("unmap")
    .argument("[path]", "directory to unmap (defaults to the current directory)")
    .description("Remove a directory mapping")
    .action(async (target?: string) => {
      await (await load.unmap())(target);
    });

  program
    .command("default")
    .argument("[id]", "profile id")
    .description("Set the fallback profile used where no mapping matches")
    .action(async (id?: string) => {
      await (await load.default())(id);
    });

  program
    .command("sync")
    .option("--dry-run", "print what would change without changing anything", false)
    .description("Regenerate every derived file")
    .action(async (options: { dryRun: boolean }) => {
      await (await load.sync())({ dryRun: options.dryRun });
    });

  program
    .command("shell-init")
    .argument("<shell>", "zsh or bash")
    .description("Print the shell snippet that shows the active profile in your prompt")
    .action(async (shell: string) => {
      await (await load.shellInit())(shell);
    });

  program
    .command("reset")
    .description("Remove all profiles and mappings")
    .action(async () => {
      await (await load.reset())();
    });

  // 인자가 없으면 map으로 보낸다. commander의 `isDefault: true`를 쓰면 오타난 하위
  // 명령이 map의 인자로 흘러들어가 "too many arguments for 'map'"이라는, 무엇을
  // 잘못 쳤는지 알려 주지 않는 안내가 나온다. 여기서 넣어 주면 그 외의 입력은
  // 전부 정상적으로 "unknown command" 경로를 타고 오타 제안까지 받는다.
  await program.parseAsync(argv.length <= 2 ? [...argv, "map"] : [...argv]);
};

/**
 * 최상위 오류 처리. 이게 없으면 프롬프트에서 Ctrl-C 한 번에 `ExitPromptError`와
 * node 내부 프레임 여섯 줄이 쏟아지고, "A profile needs a name." 처럼 사용자에게
 * 보여 주려고 쓴 문장까지 스택 트레이스에 묻힌다.
 */
export const main = async (argv: readonly string[]): Promise<void> => {
  try {
    await run(argv);
  } catch (error) {
    // inquirer는 Ctrl-C를 예외로 던진다. 사용자가 그만두겠다고 한 것이지 오류가 아니다.
    if (error instanceof Error && error.name === "ExitPromptError") {
      process.exitCode = 130;
      return;
    }
    // 오류 경로에서만 chalk를 부른다. 정상 실행에 색을 위해 모듈을 하나 더 읽을 이유가 없다.
    const { default: chalk } = await import("chalk");
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(chalk.red(`${message}\n`));
    process.exitCode = 1;
  }
};
