import { randomInt } from "node:crypto";
import { JOIN_CODE_ALPHABET, JOIN_CODE_LENGTH } from "@tmp/shared";

/** Cryptographically random, so codes can't be predicted from earlier ones. */
export function newJoinCode(): string {
  let out = "";
  for (let i = 0; i < JOIN_CODE_LENGTH; i++) out += JOIN_CODE_ALPHABET[randomInt(JOIN_CODE_ALPHABET.length)];
  return out;
}
