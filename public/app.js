import * as jose from "jose";
import { create, toJson, toBinary, fromBinary } from "@bufbuild/protobuf";
import { EventsSchema } from "./event_pb.js";

function createRandomString(length) {
  const chars =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let result = "";
  const randomArray = new Uint8Array(length);
  crypto.getRandomValues(randomArray);
  randomArray.forEach((number) => {
    result += chars[number % chars.length];
  });
  return result;
}

function buf2hex(buffer) {
  // buffer is an ArrayBuffer
  return [...new Uint8Array(buffer)]
    .map((x) => x.toString(16).padStart(2, "0"))
    .join("");
}

const localStorage = window.localStorage;

async function init() {
  const storeEntry = {};

  const keypair = await jose.generateKeyPair("ES256", { extractable: true });

  storeEntry.key = {
    public: await window.crypto.subtle.exportKey("jwk", keypair.publicKey),
    private: await window.crypto.subtle.exportKey("jwk", keypair.privateKey),
  };

  storeEntry.handle = createRandomString(16);
  const seed = create(EventsSchema, {
    events: [
      {
        msg: {
          case: "SeedActor",
          value: {
            handle: storeEntry.handle,
          },
        },
      },
    ],
  });

  const response = await fetch("http://localhost:8081/state", {
    method: "POST",
    headers: {
      Authorization: await auth(keypair.privateKey, keypair.publicKey),
      "Content-Type": "application/x-protobuf",
    },
    body: toBinary(EventsSchema, seed),
  });

  const jsonResponse = await response.json();
  if (jsonResponse[0].error) {
    throw jsonResponse[0].error;
  }

  localStorage.setItem("state", JSON.stringify(storeEntry));
  localStorage.setItem("cursor", jsonResponse[0].ts);
}

async function getState() {
  const state = JSON.parse(localStorage.getItem("state"));
  const cursor = localStorage.getItem("cursor");

  if (!state) {
    await init();

    return getState();
  }

  return {
    handle: state.handle,
    cursor: cursor,
    privateKey: await window.crypto.subtle.importKey(
      "jwk",
      state.key.private,
      { name: "ECDSA", namedCurve: "P-256" },
      false,
      ["sign"],
    ),
    publicKey: await window.crypto.subtle.importKey(
      "jwk",
      state.key.public,
      { name: "ECDSA", namedCurve: "P-256" },
      true,
      ["verify"],
    ),
  };
}

async function auth(privateKey, publicKey) {
  return await new jose.SignJWT({})
    .setProtectedHeader({
      alg: "ES256",
      jwk: await window.crypto.subtle.exportKey("jwk", publicKey),
    })
    .setIssuedAt()
    .setIssuer("self")
    .setAudience("thekeeper")
    .setExpirationTime("5s")
    .sign(privateKey);
}

const state = await getState();

const response = await fetch(
  "http://localhost:8081/state?from=" + state.cursor,
  {
    method: "GET",
    headers: {
      Authorization: await auth(state.privateKey, state.publicKey),
    },
  },
);

const protobufObject = await fromBinary(
  EventsSchema,
  new Uint8Array(await response.arrayBuffer()),
);

console.log(protobufObject.events);

state.cursor = protobufObject.events[protobufObject.events.length - 1].ts;

localStorage.setItem("cursor", state.cursor);

let seed = create(EventsSchema, {
  events: [
    {
      msg: {
        case: "SeedPlayer",
        value: {
          handle: state.handle,
          playerId: createRandomString(8),
        },
      },
    },
  ],
});

console.log(toJson(EventsSchema, seed));

await fetch("http://localhost:8081/state", {
  method: "POST",
  headers: {
    Authorization: await auth(state.privateKey, state.publicKey),
    "Content-Type": "application/x-protobuf",
  },
  body: toBinary(EventsSchema, seed),
});

/*


const form = document.getElementById("form");

form.addEventListener("submit", async function (event) {
    event.preventDefault();
    const formData = Object.fromEntries(new FormData(form));
    const events = [];

    events.push(
        { key: "seed", data: { index: 0 } },
        { key: "set-name", data: { ...formData, index: 0 } },
    )



    await fetch("http://localhost:8081/state", {
        method: "POST",
        headers: {
            "Authorization": await auth(privateKey, publicKey),
        },
        body: JSON.stringify(events),
    })
});
*/
