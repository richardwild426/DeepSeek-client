import { platform } from "nsh";
import { run, spawn } from "process";

const tool = "/usr/bin/security";
const identity = ["-s", "app.yantai.deepseek.api-key", "-a", "DeepSeek"];
const unavailable = "钥匙串操作失败，请检查 macOS 钥匙串是否已解锁。";

export function hasCredentialVault(): boolean {
  return platform.os === "macos";
}

export async function loadCredential(): Promise<string | null> {
  const result = await run(tool, ["find-generic-password", ...identity, "-w"], { timeoutMs: 15_000 });
  if (result.code === 44) return null;
  if (result.code !== 0) throw new Error(unavailable);
  return result.stdout.trim() || null;
}

export async function saveCredential(key: string): Promise<void> {
  if (!key || key.length > 1024) throw new Error("API Key 长度无效。");
  // Feed hex data to the tool's interactive parser. The credential never appears in argv.
  const hex = Array.from(new TextEncoder().encode(key), (byte) => byte.toString(16).padStart(2, "0")).join("");
  await new Promise<void>((resolve, reject) => {
    const child = spawn(tool, ["-i"], { stdin: "pipe", timeoutMs: 15_000 });
    child.on("exit", ({ code, error }) => code === 0 && !error ? resolve() : reject(new Error(unavailable)));
    try {
      child.write(`add-generic-password ${identity.join(" ")} -U -X ${hex}\n`);
      child.end();
    } catch {
      child.kill();
      reject(new Error(unavailable));
    }
  });
  // The interactive runner can exit 0 even when a subcommand fails.
  if (await loadCredential() !== key) throw new Error(unavailable);
}

export async function deleteCredential(): Promise<void> {
  const result = await run(tool, ["delete-generic-password", ...identity], { timeoutMs: 15_000 });
  if (result.code !== 0 && result.code !== 44) throw new Error(unavailable);
}
