import chalk from "chalk";
import { createContext, syncAndPersist } from "../core/context.ts";
import { findRepoRoot, toAbsolutePath } from "../core/paths.ts";
import { unassignPath } from "./map.ts";

export const runUnmap = async (requested?: string): Promise<void> => {
  const context = await createContext();
  const store = context.store.read();
  // map은 저장소 루트를 매핑하므로 unmap도 같은 자리를 봐야 한다. 그러지 않으면
  // 하위 디렉토리에서 map은 되는데 unmap은 "매핑 없음"으로 실패한다.
  const target =
    requested === undefined
      ? (findRepoRoot(toAbsolutePath(process.cwd())) ?? toAbsolutePath(process.cwd()))
      : toAbsolutePath(requested);

  const owner = store.profiles.find((profile) => profile.paths.includes(target));
  if (!owner) {
    process.stdout.write(chalk.yellow(`No mapping for ${target}.\n`));
    process.exitCode = 1;
    return;
  }

  await syncAndPersist(context, unassignPath(store, target));
  process.stdout.write(chalk.green(`✓ Removed the mapping ${target} → ${owner.id}\n`));
};
