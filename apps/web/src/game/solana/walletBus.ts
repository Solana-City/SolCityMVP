/**
 * One request to the wallet, over the game event bus, answered by
 * WalletSignBridge in React.
 *
 * Every request carries an id and only its own answer settles it. The four
 * copies this replaced each listened with `once` for "the next answer of this
 * kind", with a 60 second timeout that never removed the listener. So a player
 * who took longer than a minute to approve (reading the wallet's warnings, or
 * switching to the wallet app on a phone) was rejected by the game while the
 * wallet was still open, and their late approval was then picked up by
 * whatever request came next, usually the retry, which got the OLD
 * transaction. "I approved and it still failed" was exactly that.
 *
 * The timeout is now long enough to read a warning and switch apps. The wallet
 * itself rejects when the player declines, so the timeout is only a backstop
 * for a wallet that never answers at all.
 */

type Bus = {
  on: (event: string, cb: (...a: any[]) => void) => void;
  off: (event: string, cb: (...a: any[]) => void) => void;
  emit: (event: string, ...a: any[]) => void;
};

export const WALLET_APPROVAL_TIMEOUT_MS = 5 * 60_000;

let nextId = 1;

export function walletRequest<T>(
  ask: string, ok: string, fail: string, payload: unknown,
  timeoutMs: number = WALLET_APPROVAL_TIMEOUT_MS,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const bus = (globalThis as any).__solCityGameEvents as Bus | undefined;
    if (!bus) {
      // Reject, never resolve with a fake value: a non-base58 "signature"
      // crashes confirmTransaction with an assertion that escapes try/catch.
      reject(new Error("wallet bus not available, session offline"));
      return;
    }
    const id = nextId++;
    const done = () => {
      clearTimeout(timer);
      bus.off(ok, onOk);
      bus.off(fail, onFail);
    };
    const onOk = (value: T, replyId?: number) => {
      if (replyId !== id) return;
      done();
      resolve(value);
    };
    const onFail = (err: unknown, replyId?: number) => {
      if (replyId !== id) return;
      done();
      reject(err instanceof Error ? err : new Error(String((err as any)?.message ?? err)));
    };
    const timer = setTimeout(() => {
      done();
      reject(new Error("wallet did not answer"));
    }, timeoutMs);
    bus.on(ok, onOk);
    bus.on(fail, onFail);
    bus.emit(ask, payload, id);
  });
}
