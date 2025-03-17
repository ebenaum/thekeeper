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

function newData() {
  return {
    players: {},
  };
}

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
  localStorage.setItem("data", JSON.stringify(newData()));
}

async function getState() {
  const state = JSON.parse(localStorage.getItem("state"));
  const cursor = localStorage.getItem("cursor");
  const data = JSON.parse(localStorage.getItem("data"));

  if (!state) {
    await init();

    return getState();
  }

  return {
    handle: state.handle,
    data: data,
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

async function sync(state, reset) {
  const cursor = reset ? -1 : state.cursor;

  if (reset) {
    state.data = newData();
  }

  const response = await fetch("http://localhost:8081/state?from=" + cursor, {
    method: "GET",
    headers: {
      Authorization: await auth(state.privateKey, state.publicKey),
    },
  });

  const msg = await fromBinary(
    EventsSchema,
    new Uint8Array(await response.arrayBuffer()),
  );

  msg.events.forEach(function (event) {
    processEvent(state.data, event.msg.case, event.msg.value);
    state.cursor = event.ts;
  });

  localStorage.setItem("cursor", state.cursor);
  localStorage.setItem("data", JSON.stringify(state.data));
}

const state = await getState();

await sync(state, true);

function processEvent(data, eventType, eventValue) {
  switch (eventType) {
    case "SeedPlayer":
      if (data.players[eventValue.playerId]) {
        throw Error(`player ${eventValue.playerId} already exists`);
      }

      data.players[eventValue.playerId] = {};

      break;
    case "SeedActor":
      break;
    default:
      console.log(`unknown event ${eventType} ${eventValue}`);
  }
}

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

const response = await fetch("http://localhost:8081/state", {
  method: "POST",
  headers: {
    Authorization: await auth(state.privateKey, state.publicKey),
    "Content-Type": "application/x-protobuf",
  },
  body: toBinary(EventsSchema, seed),
});

await sync(state, false);

/*
setInterval(function(){
  const matches = document.querySelectorAll("input");
  matches.forEach(function(match) {
    console.log(match.className, match.attributes, match.value,  match.checked)
  })
}, 2000)
*/

const matches = document.querySelectorAll(".q-select li");
matches.forEach(function (match) {
  match.addEventListener("click", function (e) {
    let classes = e.currentTarget.getAttribute("class").split(" ");
    var index = classes.indexOf("selected");
    if (index !== -1) {
      classes.splice(index, 1);
    } else {
      classes.push("selected");
    }

    e.currentTarget.setAttribute("class", classes.join(" "));
  });
});

setInterval(function () {
  const matches = document.querySelectorAll(".q-select li");
  matches.forEach(function (match) {
    console.log(match.className, match.attributes, match.value, match.checked);
  });
}, 2000);
