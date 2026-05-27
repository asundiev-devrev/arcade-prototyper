import { describe, expect, it, beforeEach } from "vitest";
import worker from "../src/index";

const ALLOWED = "key-allowed-1";
const VALID_SHARE_ID = "2994f253-a34e-4d5c-858e-1655ff98b0be";
const VALID_RELAY = "wss://persian-tall-promotions-never.trycloudflare.com/api/multiplayer/ws";
const VALID_DEVU = "don:identity:dvrv-us-1:devo/0:devu/2676";

class FakeKV implements Partial<KVNamespace> {
  store = new Map<string, string>();
  lastPutOpts: KVNamespacePutOptions | undefined;
  async get(key: string) {
    return this.store.get(key) ?? null;
  }
  async put(key: string, value: string, opts?: KVNamespacePutOptions) {
    this.store.set(key, value);
    this.lastPutOpts = opts;
  }
}

function makeEnv(kv: FakeKV = new FakeKV()): any {
  return {
    CF_API_TOKEN: "ignored",
    ALLOWED_KEYS: `${ALLOWED},another-key`,
    CF_ACCOUNT_ID: "ignored",
    ACCESS_POLICY_ID: "ignored",
    KV_RENDEZVOUS: kv,
  };
}

function publishReq(opts: { shareId?: string; auth?: string; body?: unknown } = {}) {
  return new Request(`https://w/rendezvous/${opts.shareId ?? VALID_SHARE_ID}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${opts.auth ?? ALLOWED}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(
      opts.body ?? {
        relayUrl: VALID_RELAY,
        hostDevu: VALID_DEVU,
        hostDisplayName: "Gil",
      },
    ),
  });
}

function fetchReq(shareId: string, auth: string = ALLOWED) {
  return new Request(`https://w/rendezvous/${shareId}`, {
    method: "GET",
    headers: { Authorization: `Bearer ${auth}` },
  });
}

describe("rendezvous", () => {
  let env: any;
  let kv: FakeKV;
  beforeEach(() => {
    kv = new FakeKV();
    env = makeEnv(kv);
  });

  it("POST writes a record and GET returns it", async () => {
    const post = await worker.fetch(publishReq(), env);
    expect(post.status).toBe(204);
    const get = await worker.fetch(fetchReq(VALID_SHARE_ID), env);
    expect(get.status).toBe(200);
    const body = await get.json();
    expect(body.shareId).toBe(VALID_SHARE_ID);
    expect(body.relayUrl).toBe(VALID_RELAY);
    expect(body.hostDevu).toBe(VALID_DEVU);
    expect(body.hostDisplayName).toBe("Gil");
    expect(typeof body.publishedAt).toBe("number");
  });

  it("GET returns 404 when no record exists", async () => {
    const res = await worker.fetch(fetchReq("00000000-0000-0000-0000-000000000000"), env);
    expect(res.status).toBe(404);
  });

  it("rejects unknown shareKey on POST", async () => {
    const res = await worker.fetch(publishReq({ auth: "rogue" }), env);
    expect(res.status).toBe(401);
  });

  it("rejects unknown shareKey on GET", async () => {
    const res = await worker.fetch(fetchReq(VALID_SHARE_ID, "rogue"), env);
    expect(res.status).toBe(401);
  });

  it("rejects invalid shareId format on POST", async () => {
    const res = await worker.fetch(publishReq({ shareId: "not-a-uuid" }), env);
    expect(res.status).toBe(400);
  });

  it("rejects invalid relayUrl format on POST", async () => {
    const res = await worker.fetch(publishReq({ body: {
      relayUrl: "https://evil.example.com/spoof",
      hostDevu: VALID_DEVU,
      hostDisplayName: "x",
    }}), env);
    expect(res.status).toBe(400);
  });

  it("rejects malformed hostDevu on POST", async () => {
    const res = await worker.fetch(publishReq({ body: {
      relayUrl: VALID_RELAY,
      hostDevu: "not-a-devu",
      hostDisplayName: "x",
    }}), env);
    expect(res.status).toBe(400);
  });

  it("overwrites prior record on republish", async () => {
    await worker.fetch(publishReq(), env);
    const NEW = "wss://different-tunnel-here.trycloudflare.com/api/multiplayer/ws";
    await worker.fetch(publishReq({ body: {
      relayUrl: NEW,
      hostDevu: VALID_DEVU,
      hostDisplayName: "Gil",
    }}), env);
    const got = await (await worker.fetch(fetchReq(VALID_SHARE_ID), env)).json();
    expect(got.relayUrl).toBe(NEW);
  });

  it("POST writes record with 7-day expirationTtl", async () => {
    const post = await worker.fetch(publishReq(), env);
    expect(post.status).toBe(204);
    expect(kv.lastPutOpts?.expirationTtl).toBe(7 * 24 * 60 * 60);
  });

  it("rejects request with missing Authorization header", async () => {
    const req = new Request(`https://w/rendezvous/${VALID_SHARE_ID}`, {
      method: "GET",
    });
    const res = await worker.fetch(req, env);
    expect(res.status).toBe(401);
  });

  it("rejects POST with malformed JSON body", async () => {
    const req = new Request(`https://w/rendezvous/${VALID_SHARE_ID}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${ALLOWED}`,
        "Content-Type": "application/json",
      },
      body: "{not-json",
    });
    const res = await worker.fetch(req, env);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("bad_json");
  });

  it("rejects POST with empty hostDisplayName", async () => {
    const res = await worker.fetch(publishReq({ body: {
      relayUrl: VALID_RELAY,
      hostDevu: VALID_DEVU,
      hostDisplayName: "",
    }}), env);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("bad_host_name");
  });

  it("rejects POST with hostDisplayName over 200 chars", async () => {
    const res = await worker.fetch(publishReq({ body: {
      relayUrl: VALID_RELAY,
      hostDevu: VALID_DEVU,
      hostDisplayName: "x".repeat(201),
    }}), env);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("bad_host_name");
  });

  it("returns 405 on unsupported method", async () => {
    const req = new Request(`https://w/rendezvous/${VALID_SHARE_ID}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${ALLOWED}` },
    });
    const res = await worker.fetch(req, env);
    expect(res.status).toBe(405);
  });
});
