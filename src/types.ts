declare const brand: unique symbol;

type Brand<T, B extends string> = T & { readonly [brand]: B };

/** 검증을 통과한 프로파일 식별자. `^[a-z0-9][a-z0-9-]{0,31}$` */
export type ProfileId = Brand<string, "ProfileId">;

/** 정규화·심볼릭 링크 해석이 끝난 절대경로. 후행 슬래시 없음, 구분자는 `/`. */
export type AbsolutePath = Brand<string, "AbsolutePath">;

export interface Profile {
  readonly id: ProfileId;
  readonly name: string;
  readonly email: string;
  readonly signingKey: string | null;
  readonly color: string;
  readonly paths: readonly AbsolutePath[];
}

export interface StoreV2 {
  readonly version: 2;
  readonly defaultProfile: ProfileId | null;
  readonly profiles: readonly Profile[];
  readonly managedConditions: readonly string[];
}

export interface StoreV1User {
  readonly name: string;
  readonly email: string;
  /**
   * `exactOptionalPropertyTypes` 아래에서는 `?: string | null`이 "없거나 string|null"만
   * 뜻하고 `undefined`가 실린 경우를 배제한다. zod의 `.optional()`은
   * `string | null | undefined`로 추론하므로 `| undefined`를 명시해야 검증 결과를
   * 캐스트 없이 그대로 받을 수 있다.
   */
  readonly signingKey?: string | null | undefined;
}

export interface StoreV1 {
  readonly users: readonly StoreV1User[];
}

/**
 * 프롬프트와 `status`가 공유하는 상태.
 * 여기에 값을 추가하면 셸 렌더링 분기(8.2 표)도 함께 고쳐야 한다.
 */
export type ResolutionState = "mapped" | "default" | "local-override" | "no-identity";
