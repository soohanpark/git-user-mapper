import chalk from "chalk";
import { createContext, syncAndPersist } from "../core/context.ts";
import { confirm, select } from "../core/prompt.ts";
import type { ProfileId } from "../types.ts";

export const runRemove = async (requested?: string): Promise<void> => {
  const context = await createContext();
  const store = context.store.read();

  if (store.profiles.length === 0) {
    process.stdout.write("No profiles to remove.\n");
    return;
  }

  const target: ProfileId | null =
    requested === undefined
      ? await select<ProfileId | null>({
          message: "Remove which profile?",
          choices: [
            ...store.profiles.map((profile) => ({
              name: `${profile.id}  ${profile.name} <${profile.email}>`,
              value: profile.id,
            })),
            { name: "Cancel", value: null },
          ],
        })
      : (requested as ProfileId);

  if (target === null) {
    process.stdout.write("Cancelled.\n");
    return;
  }
  const doomed = store.profiles.find((profile) => profile.id === target);
  if (!doomed) {
    process.stdout.write(chalk.red(`No profile named ${target}.\n`));
    process.exitCode = 1;
    return;
  }

  // 인자로 부르는 경로는 대화형 목록의 "Cancel"을 거치지 않는다. 매핑까지 함께
  // 사라지는 명령이므로 무엇이 없어지는지 보여 주고 한 번 확인받는다.
  if (requested !== undefined && doomed.paths.length > 0) {
    const proceed = await confirm({
      message: `Remove ${target} and its ${doomed.paths.length} mapping(s)?\n${doomed.paths
        .map((mapped) => `    ${mapped}`)
        .join("\n")}\n`,
      default: false,
    });
    if (!proceed) {
      process.stdout.write("Cancelled.\n");
      return;
    }
  }

  // 기본 프로파일을 지워도 ~/.gitconfig의 [user]는 남긴다.
  // identity를 없애면 커밋이 실패하므로 마지막 값이 남는 편이 안전하다.
  const next = {
    ...store,
    defaultProfile: store.defaultProfile === target ? null : store.defaultProfile,
    profiles: store.profiles.filter((profile) => profile.id !== target),
  };
  await syncAndPersist(context, next);

  process.stdout.write(chalk.green(`✓ Removed ${target}\n`));
  if (store.defaultProfile === target) {
    process.stdout.write(
      chalk.dim("It was the default profile. ~/.gitconfig [user] was left as it is.\n"),
    );
  }
};
