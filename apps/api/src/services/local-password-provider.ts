import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";

export type PasswordCredential = {
  passwordHash: string;
  salt: string;
  scryptN: number;
  scryptR: number;
  scryptP: number;
  keyLength: number;
};

const DEFAULT_PARAMS = {
  scryptN: 16_384,
  scryptR: 8,
  scryptP: 1,
  keyLength: 64,
};

function deriveKey(
  password: string,
  salt: string,
  credential: Pick<PasswordCredential, "scryptN" | "scryptR" | "scryptP" | "keyLength">,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(
      password,
      salt,
      credential.keyLength,
      {
        N: credential.scryptN,
        r: credential.scryptR,
        p: credential.scryptP,
      },
      (error, key) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(key);
      },
    );
  });
}

export async function hashPassword(password: string): Promise<PasswordCredential> {
  const salt = randomBytes(16).toString("base64url");
  const key = await deriveKey(password, salt, DEFAULT_PARAMS);

  return {
    passwordHash: key.toString("base64url"),
    salt,
    ...DEFAULT_PARAMS,
  };
}

export async function verifyPassword(
  password: string,
  credential: PasswordCredential,
): Promise<boolean> {
  const expected = Buffer.from(credential.passwordHash, "base64url");
  const actual = await deriveKey(password, credential.salt, credential);

  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
