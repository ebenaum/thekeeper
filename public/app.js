// @ts-check

// @ts-ignore
import * as jose from "jose";
// @ts-ignore
import { create, toJson, toBinary, fromBinary } from "@bufbuild/protobuf";
import { EventsSchema } from "./event_pb.js";

/**
 *
 * @param {number} length
 * @returns {string}
 */
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

/**
 * @typedef {Object} State
 * @property {string} handle
 * @property {{players: Object.<string, {playerId: string}>}} data
 * @property {number} cursor
 * @prop {CryptoKey} privateKey
 * @prop {CryptoKey} publicKey
 */

/**
 *
 * @returns {Promise<State>}
 */
async function getState() {
  const state = JSON.parse(
    /** @type {string} */ (localStorage.getItem("state")),
  );
  const cursor = Number(/** @type {string} */ (localStorage.getItem("cursor")));

  const data = JSON.parse(/** @type {string} */ (localStorage.getItem("data")));

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

/**
 *
 * @param {CryptoKey} privateKey
 * @param {CryptoKey} publicKey
 * @returns
 */
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

/**
 *
 * @param {State} state
 * @param {boolean} reset
 */
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

  localStorage.setItem("cursor", state.cursor.toString());
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

/* TEMPLATES */
const /** @type {HTMLTemplateElement | null} */ raceTemplate =
    document.querySelector("#template__race-option");
if (!raceTemplate) {
  throw new Error("cannot retrieve race-option template");
}

const /** @type {HTMLTemplateElement | null} */ skillTemplate =
    document.querySelector("#template__skill");
if (!skillTemplate) {
  throw new Error("cannot retrieve skill template");
}
/* TEMPLATES               */

/**
 * @typedef {Object} UniversEntry
 * @property {string} key
 * @property {string[]} tags
 * @property {string} label
 * @property {string} description
 */

const universResponse = await fetch("http://localhost:8080/univers.json");
const /** @type {UniversEntry[]} */ univers = await universResponse.json();
const races = univers.filter((entry) => entry.tags.includes("race"));

const skills = univers
  .filter((entry) => entry.tags.includes("skill"))
  .map((skill) => {
    const levels = univers
      .filter((entry) => entry.tags.includes("skill:" + skill.key))
      .map((level) => {
        const cost = level.tags
          .find((tag) => tag.startsWith("cost:"))
          ?.split(":")[1];
        const rank = level.tags
          .find((tag) => tag.startsWith("level:"))
          ?.split(":")[1];

        if (!cost || !rank) {
          throw new Error("missing cost or rank on " + level.toString());
        }

        return { cost: parseInt(cost), rank: parseInt(rank), ...level };
      });

    return { levels, rankMax: levels.length, ...skill };
  });

console.log(skills);

/**
 * @typedef {Object} Skill
 * @property {string} label
 * @property {string} description
 * @property {number} rankMax
 * @property {{cost: number, rank: number, label: string, description: string}[]} levels
 */

/**
 *
 * @param {Skill} skill
 * @param {number} rank
 * @return {{description: string, title: string, rankTitle: string, rankDescription: string, nextRankDescription: string | null}}}
 */
function skillBuild(skill, rank) {
  return {
    title:
      rank === 0
        ? skill.label
        : skill.levels[rank - 1].label +
          " - Coût : " +
          skill.levels
            .slice(0, rank)
            .reduce((cost, level) => cost + (level.cost | 0), 0),
    description:
      rank === 0 ? skill.description : skill.levels[rank - 1].description,
    rankDescription: "Rang " + rank + "/" + skill.rankMax,
    nextRankDescription:
      rank === skill.rankMax
        ? null
        : "Rang suivant - Coût " +
          skill.levels[rank].cost +
          " : " +
          skill.levels[rank].description,
    rankTitle: ["", "Novice", "Expert", "Maître"][rank],
  };
}

const skillSelect = document.querySelector(".skills");
skills.forEach((skill) => {
  for (let index = 0; index <= skill.rankMax; index++) {
    const skillDesc = skillBuild(skill, index);

    const clone = skillTemplate.content.cloneNode(true);
    clone.querySelector(".skill__title").textContent = skillDesc.title;
    clone.querySelector(".skill__content__description").textContent =
      skillDesc.description;
    clone.querySelector(".skill__content__level__span1").textContent =
      skillDesc.rankDescription;
    clone.querySelector(".skill__content__level__span2").textContent =
      skillDesc.rankTitle;
    clone.querySelector(".skill__content__next-level").textContent =
      skillDesc.nextRankDescription;

    skillSelect?.appendChild(clone);
  }
});

const raceSelect = document.querySelector(".race-select");
races.forEach((race) => {
  const clone = raceTemplate.content.cloneNode(true);
  clone.querySelector(".race-select__race-option__title").textContent =
    race.label;
  clone.querySelector(".race-select__race-option__description").textContent =
    race.description;
  raceSelect?.appendChild(clone);
});

const matches = document.querySelectorAll(".q-select--unique");
matches.forEach(function (match) {
  const lis = match.querySelectorAll("li");

  lis.forEach((li, i) => {
    li.addEventListener("click", function (e) {
      let classes =
        /** @type {Element} */ (e.currentTarget)
          .getAttribute("class")
          ?.split(" ") || [];

      const index = classes.indexOf("selected");
      if (index !== -1) {
        classes.splice(index, 1);
      } else {
        classes.push("selected");
        lis.forEach((li2, j) => {
          if (i == j) return;
          let classes = li2.getAttribute("class")?.split(" ") || [];
          const index = classes.indexOf("selected");
          if (index !== -1) classes.splice(index, 1);

          li2.setAttribute("class", classes.join(" "));
        });
      }

      /** @type {Element} */ (e.currentTarget).setAttribute(
        "class",
        classes.join(" "),
      );
    });
  });
});
