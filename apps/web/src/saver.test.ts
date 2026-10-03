import { describe, expect, it } from "vitest";

import { err, ok } from "@mba/core";
import type { Result } from "@mba/core";

import { createSaver } from "./saver.js";
import type { SaveStatus } from "./saver.js";

/** A fake server: every request waits until the test answers it. */
function fakeServer() {
  const requests: {
    value: number;
    answered: boolean;
    resolve: (result: Result<unknown, string>) => void;
  }[] = [];
  let maxInFlight = 0;

  const pending = () => requests.filter((request) => !request.answered);

  const send = (value: number) =>
    new Promise<Result<unknown, string>>((resolve) => {
      requests.push({ value, answered: false, resolve });
      maxInFlight = Math.max(maxInFlight, pending().length);
    });

  const answer = (index: number, result: Result<unknown, string> = ok(null)) => {
    const request = requests[index];
    if (request === undefined) throw new Error(`request ${index} was never sent`);
    if (request.answered) throw new Error(`request ${index} was already answered`);
    request.answered = true;
    request.resolve(result);
  };

  return {
    send,
    answer,
    sent: () => requests.map((request) => request.value),
    pending: () => pending().length,
    /** Answers everything that is waiting for an answer. */
    answerPending: () => {
      requests.forEach((request, index) => {
        if (!request.answered) answer(index);
      });
    },
    maxInFlight: () => maxInFlight,
  };
}

/** Lets pending promise callbacks run. */
const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

function setup() {
  const server = fakeServer();
  const statuses: SaveStatus<string>[] = [];
  const save = createSaver(server.send, (status) => statuses.push(status));
  return { server, save, kinds: () => statuses.map((status) => status.kind), statuses };
}

describe("createSaver", () => {
  it("sends the first value straight away", () => {
    const { server, save, kinds } = setup();
    save(1);
    expect(server.sent()).toEqual([1]);
    expect(kinds()).toEqual(["saving"]);
  });

  it("reports saved once the server has answered", async () => {
    const { server, save, kinds } = setup();
    save(1);
    server.answer(0);
    await settle();
    expect(kinds()).toEqual(["saving", "saved"]);
  });

  it("holds later values back while a request is in flight, then sends only the newest", async () => {
    const { server, save } = setup();
    save(1);
    save(2);
    save(3);
    expect(server.sent()).toEqual([1]);

    server.answer(0);
    await settle();
    expect(server.sent()).toEqual([1, 3]);
  });

  it("never has two requests in flight, however fast the values arrive", async () => {
    const { server, save } = setup();
    for (let value = 0; value < 50; value++) {
      save(value);
      // Now and then the server catches up.
      if (value % 7 === 0) {
        server.answerPending();
        await settle();
      }
    }
    while (server.pending() > 0) {
      server.answerPending();
      await settle();
    }

    expect(server.maxInFlight()).toBe(1);
    // Whatever was skipped, the last value is the last thing the server heard.
    expect(server.sent().at(-1)).toBe(49);
  });

  it("does not claim saved while a newer value is still waiting", async () => {
    const { server, save, kinds } = setup();
    save(1);
    save(2);
    server.answer(0);
    await settle();
    expect(kinds()).toEqual(["saving", "saving"]);

    server.answer(1);
    await settle();
    expect(kinds()).toEqual(["saving", "saving", "saved"]);
  });

  it("reports a failure with its error, and carries on with the next value", async () => {
    const { server, save, statuses } = setup();
    save(1);
    server.answer(0, err("network"));
    await settle();
    expect(statuses.at(-1)).toEqual({ kind: "failed", error: "network" });

    save(2);
    expect(server.sent()).toEqual([1, 2]);
    server.answer(1);
    await settle();
    expect(statuses.at(-1)).toEqual({ kind: "saved" });
  });

  it("starts again after going idle", async () => {
    const { server, save } = setup();
    save(1);
    server.answer(0);
    await settle();

    save(2);
    expect(server.sent()).toEqual([1, 2]);
  });
});
