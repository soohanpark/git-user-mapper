import { input } from "@inquirer/prompts";
import chalk from "chalk";
import { createContext, syncAndPersist } from "../core/context.ts";
import { pickColor, toProfileId, uniqueId } from "../core/profile.ts";
import type { Profile, StoreV2 } from "../types.ts";

export interface ProfileInput {
  readonly id: string;
  readonly name: string;
  readonly email: string;
  readonly signingKey: string;
  readonly index: number;
}

/**
 * 탭과 개행은 `mapping.tsv`의 칸·줄 구분자다. git은 값을 알아서 인용하므로 설정 파일이
 * 깨지지는 않지만, 표에 실을 수 없어 sync가 거부한다. 그 실패를 입력 시점으로 당긴다.
 */
const hasLayoutBreakingChar = (value: string): boolean => /[\t\n\r]/.test(value);

export const buildProfile = (raw: ProfileInput): Profile => {
  const name = raw.name.trim();
  const email = raw.email.trim();
  const signingKey = raw.signingKey.trim();

  if (name === "") throw new Error("A profile needs a name.");
  if (email === "") throw new Error("A profile needs an email.");
  for (const [label, value] of [
    ["name", name],
    ["email", email],
    ["signing key", signingKey],
  ] as const) {
    if (hasLayoutBreakingChar(value)) {
      throw new Error(`A profile ${label} cannot contain a tab or a line break.`);
    }
  }

  return {
    id: toProfileId(raw.id.trim()),
    name,
    email,
    signingKey: signingKey === "" ? null : signingKey,
    color: pickColor(raw.index),
    paths: [],
  };
};

const required = (label: string) => (value: string) => {
  if (value.trim() === "") return `Please enter the ${label}.`;
  if (hasLayoutBreakingChar(value)) return `The ${label} cannot contain a tab or a line break.`;
  return true;
};

/**
 * `add`와 `map`의 "+ Add a new profile"이 같은 검증을 쓰게 한 군데로 모은다.
 * 따로 두었을 때 map 쪽에는 검증이 하나도 붙어 있지 않아 빈 이름과 중복 id가 통과했다.
 */
export const promptForProfile = async (store: StoreV2): Promise<Profile> => {
  const taken = new Set(store.profiles.map((profile) => profile.id as string));

  const name = await input({ message: "Git user name", validate: required("name") });
  const email = await input({ message: "Git email", validate: required("email") });
  const signingKey = await input({
    message: "GPG signing key (optional)",
    validate: (value: string) => (value.trim() === "" ? true : required("signing key")(value)),
  });
  const id = await input({
    message: "Profile id (shown in your prompt)",
    default: uniqueId(email, taken),
    validate: (value: string) =>
      taken.has(value.trim()) ? "That id is already taken." : required("id")(value),
  });

  return buildProfile({ id, name, email, signingKey, index: store.profiles.length });
};

export const runAdd = async (): Promise<void> => {
  const context = await createContext();
  const store = context.store.read();

  const profile = await promptForProfile(store);
  const next = { ...store, profiles: [...store.profiles, profile] };
  await syncAndPersist(context, next);

  process.stdout.write(chalk.green(`✓ Added ${profile.id} (${profile.email})\n`));
};
