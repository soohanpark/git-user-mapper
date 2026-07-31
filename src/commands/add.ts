import { input } from "@inquirer/prompts";
import chalk from "chalk";
import { createContext, syncAndPersist } from "../core/context.ts";
import { pickColor, toProfileId, uniqueId } from "../core/profile.ts";
import type { Profile } from "../types.ts";

export interface ProfileInput {
  readonly id: string;
  readonly name: string;
  readonly email: string;
  readonly signingKey: string;
  readonly index: number;
}

export const buildProfile = (raw: ProfileInput): Profile => {
  const name = raw.name.trim();
  const email = raw.email.trim();
  const signingKey = raw.signingKey.trim();

  if (name === "") throw new Error("A profile needs a name.");
  if (email === "") throw new Error("A profile needs an email.");

  return {
    id: toProfileId(raw.id.trim()),
    name,
    email,
    signingKey: signingKey === "" ? null : signingKey,
    color: pickColor(raw.index),
    paths: [],
  };
};

const required = (label: string) => (value: string) =>
  value.trim() === "" ? `Please enter the ${label}.` : true;

export const runAdd = async (): Promise<void> => {
  const context = await createContext();
  const store = context.store.read();
  const taken = new Set(store.profiles.map((profile) => profile.id as string));

  const name = await input({ message: "Git user name", validate: required("name") });
  const email = await input({ message: "Git email", validate: required("email") });
  const signingKey = await input({ message: "GPG signing key (optional)" });
  const id = await input({
    message: "Profile id (shown in your prompt)",
    default: uniqueId(email, taken),
    validate: (value: string) =>
      taken.has(value.trim()) ? "That id is already taken." : required("id")(value),
  });

  const profile = buildProfile({ id, name, email, signingKey, index: store.profiles.length });
  const next = { ...store, profiles: [...store.profiles, profile] };
  await syncAndPersist(context, next);

  process.stdout.write(chalk.green(`✓ Added ${profile.id} (${profile.email})\n`));
};
