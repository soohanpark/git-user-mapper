import type { ProfileId } from "../types.ts";

export const PROFILE_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,31}$/;

const PALETTE = ["blue", "magenta", "green", "cyan", "yellow", "red"] as const;

export const isProfileId = (value: string): value is ProfileId => PROFILE_ID_PATTERN.test(value);

export const toProfileId = (value: string): ProfileId => {
  if (!isProfileId(value)) {
    throw new Error(
      `Invalid profile id ${JSON.stringify(value)}. ` +
        "Use lowercase letters, digits and hyphens, starting with a letter or digit (max 32 characters).",
    );
  }
  return value;
};

export const slugify = (source: string): string => {
  const localPart = source.split("@")[0] ?? "";
  const trimmed = localPart
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, "-")
    .replaceAll(/^-+|-+$/g, "")
    .slice(0, 32)
    .replaceAll(/-+$/g, "");
  return trimmed === "" ? "profile" : trimmed;
};

export const uniqueId = (desired: string, taken: ReadonlySet<string>): ProfileId => {
  const base = slugify(desired);
  if (!taken.has(base)) return toProfileId(base);
  // 잘라 내는 길이를 접미사에 맞춘다. 30자로 고정하면 두 자리 접미사에서 33자가 되어
  // 스스로 만든 id가 자기 패턴에 걸린다.
  for (let suffix = 2; ; suffix += 1) {
    const tail = `-${suffix}`;
    const candidate = `${base.slice(0, 32 - tail.length)}${tail}`;
    if (!taken.has(candidate)) return toProfileId(candidate);
  }
};

export const pickColor = (index: number): string => PALETTE[index % PALETTE.length] ?? "blue";
