import { expect, test } from "bun:test";
import { makeCaption } from "./live-captions";
import { finalizedCaptionText, LiveQaQueue } from "./live-qa";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

// Drain promise continuations, without timers or an actual provider request.
async function settle() { for (let i = 0; i < 6; i++) await Promise.resolve(); }

test("finalized ASR text is ready immediately, without a translation or question keyword", () => {
  const caption = makeCaption(1, "  Tell us about your background.  ");
  expect(finalizedCaptionText(caption)).toBeNull();
  caption.final = true;
  expect(finalizedCaptionText(caption)).toBe("Tell us about your background.");
  expect(caption.translationFinal).toBe(false);
  caption.original = "  ";
  expect(finalizedCaptionText(caption)).toBeNull();
});

test("the first request starts synchronously and busy requests retain FIFO order", async () => {
  const first = deferred<string>();
  const requests: number[] = [];
  const starts: number[] = [];
  const results: string[] = [];
  const queue = new LiveQaQueue<number, string>({
    request: (item) => {
      requests.push(item);
      return item === 1 ? first.promise : Promise.resolve(`answer ${item}`);
    },
    onStart: (item) => starts.push(item),
    onResult: (_, result) => results.push(result),
    onError: () => {},
  });

  expect(queue.enqueue(1)).toBe(true);
  expect(requests).toEqual([1]);
  queue.enqueue(2);
  queue.enqueue(3);
  expect(requests).toEqual([1]);
  first.resolve("answer 1");
  await settle();
  expect(requests).toEqual([1, 2, 3]);
  expect(starts).toEqual([1, 2, 3]);
  expect(results).toEqual(["answer 1", "answer 2", "answer 3"]);
});

test("a failed request reports the error and does not block the next request", async () => {
  const first = deferred<string>();
  const results: string[] = [];
  const errors: string[] = [];
  const queue = new LiveQaQueue<number, string>({
    request: (item) => item === 1 ? first.promise : Promise.resolve("next answer"),
    onResult: (_, result) => results.push(result),
    onError: (item, error) => errors.push(`${item}: ${error}`),
  });
  queue.enqueue(1);
  queue.enqueue(2);
  first.reject(new Error("model unavailable"));
  await settle();
  expect(errors).toEqual(["1: Error: model unavailable"]);
  expect(results).toEqual(["next answer"]);
});

test("reset discards waiting work and late results without overlapping provider calls", async () => {
  const old = deferred<string>();
  const requests: number[] = [];
  const results: string[] = [];
  const queue = new LiveQaQueue<number, string>({
    request: (item) => {
      requests.push(item);
      return item === 1 ? old.promise : Promise.resolve("new answer");
    },
    onResult: (_, result) => results.push(result),
    onError: () => {},
  });
  queue.enqueue(1);
  queue.enqueue(2);
  queue.reset();
  queue.enqueue(3);
  expect(requests).toEqual([1]);
  old.resolve("stale answer");
  await settle();
  expect(requests).toEqual([1, 3]);
  expect(results).toEqual(["new answer"]);
});

test("reset also suppresses late failures", async () => {
  const old = deferred<string>();
  const errors: string[] = [];
  const queue = new LiveQaQueue<number, string>({
    request: () => old.promise,
    onResult: () => {},
    onError: (_, error) => errors.push(String(error)),
  });
  queue.enqueue(1);
  queue.reset();
  old.reject(new Error("stale failure"));
  await settle();
  expect(errors).toEqual([]);
});

test("page remounts share the active request slot and cancel waiting requests", async () => {
  const old = deferred<string>();
  const requests: string[] = [];
  const create = () => new LiveQaQueue<string, string>({
    request: (item) => { requests.push(item); return item === "old" ? old.promise : Promise.resolve(item); },
    onResult: () => {}, onError: () => {},
  });
  const first = create();
  first.enqueue("old");
  first.reset();
  const second = create();
  second.enqueue("cancelled");
  second.reset();
  const third = create();
  third.enqueue("new");
  expect(requests).toEqual(["old"]);
  old.resolve("ignored");
  await settle();
  expect(requests).toEqual(["old", "new"]);
});

test("overflow reports the rejected request explicitly and retains the eight queued requests", async () => {
  const first = deferred<string>();
  const requests: number[] = [];
  const errors: { item: number; error: string }[] = [];
  const queue = new LiveQaQueue<number, string>({
    request: (item) => {
      requests.push(item);
      return item === 0 ? first.promise : Promise.resolve("answer");
    },
    onResult: () => {},
    onError: (item, error) => errors.push({ item, error: String(error) }),
  });
  for (let i = 0; i <= 8; i++) expect(queue.enqueue(i)).toBe(true);
  expect(queue.enqueue(9)).toBe(false);
  expect(errors).toEqual([{ item: 9, error: "Error: Live Q&A queue is full; this transcript was not submitted" }]);
  first.resolve("answer");
  await settle();
  await settle();
  expect(requests).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
});
