import "server-only";
import {
  generateKeyPairSync,
  createPrivateKey,
  createPublicKey,
} from "node:crypto";
import { readFileSync, writeFileSync, chmodSync } from "node:fs";
import { join } from "node:path";
import { calculateJwkThumbprint, importPKCS8 } from "jose";
export async function loadKeys(dir: string) {
  const path = join(dir, "app-signing.pem");
  let pem: string;
  try {
    pem = readFileSync(path, "utf8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
    const pair = generateKeyPairSync("rsa", { modulusLength: 2048 });
    pem = pair.privateKey.export({ type: "pkcs8", format: "pem" }).toString();
    writeFileSync(path, pem, { flag: "wx", mode: 0o600 });
  }
  chmodSync(path, 0o600);
  const key = createPrivateKey(pem);
  if (
    key.asymmetricKeyType !== "rsa" ||
    (key.asymmetricKeyDetails?.modulusLength || 0) < 2048
  )
    throw new Error("Invalid signing key");
  const publicKey = createPublicKey(key).export({ format: "jwk" });
  const kid = await calculateJwkThumbprint(publicKey);
  const jwk = {
    kty: "RSA",
    kid,
    use: "sig",
    alg: "RS256",
    n: publicKey.n!,
    e: publicKey.e!,
  };
  return { kid, jwk, privateKey: await importPKCS8(pem, "RS256") };
}
