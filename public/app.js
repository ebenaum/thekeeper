// @ts-check

// @ts-ignore
import * as jose from "jose";
// @ts-ignore
import { create, toJson, toBinary, fromBinary } from "@bufbuild/protobuf";
import { EventsSchema } from "./event_pb.js";

const CHARACTERISTIC_BUDGET = 4;
const SKILL_BUDGET = 4;
const INVENTORY_BUDGET = 2;

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

/**
 * @param {any} buffer
 */
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

  msg.events.forEach(
    function (
      /** @type {{ msg: { case: any; value: any; }; ts: number; }} */ event,
    ) {
      processEvent(state.data, event.msg.case, event.msg.value);
      state.cursor = event.ts;
    },
  );

  localStorage.setItem("cursor", state.cursor.toString());
  localStorage.setItem("data", JSON.stringify(state.data));
}

const state = await getState();

await sync(state, true);

/**
 * @param {{ players: any; }} data
 * @param {any} eventType
 * @param {{ playerId: string | number; }} eventValue
 */
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
/** @type {HTMLTemplateElement | null} */
const mondeTemplate = document.querySelector("#template__group-option");
if (!mondeTemplate) {
  throw new Error("cannot retrieve monde template");
}

const /** @type {HTMLTemplateElement | null} */ raceTemplate =
    document.querySelector("#template__race-option");
if (!raceTemplate) {
  throw new Error("cannot retrieve race-option template");
}

/** @type {HTMLTemplateElement | null} */
const skillTemplate = document.querySelector("#template__skill");
if (!skillTemplate) {
  throw new Error("cannot retrieve skill template");
}

/** @type {HTMLTemplateElement | null} */
const characteristicTemplate = document.querySelector(
  "#template__characteristic",
);
if (!characteristicTemplate) {
  throw new Error("cannot retrieve characteristic template");
}

/** @type {HTMLTemplateElement | null} */
const vdvTemplate = document.querySelector("#template__vdv");
if (!vdvTemplate) {
  throw new Error("cannot retrieve vdv template");
}

/** @type {HTMLTemplateElement | null} */
const inventoryItemTemplate = document.querySelector(
  "#template__inventory_item",
);
if (!inventoryItemTemplate) {
  throw new Error("cannot retrieve inventory item template");
}
/* TEMPLATES               */

const mondeSelect = document.querySelector(".group__select");
const raceSelect = document.querySelector(".race__select");
const vdvSelect = document.querySelector(".vdv__select");
const skillSelect = document.querySelector(".skills");
const inventorySelect = document.querySelector(".inventory__select");

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
const mondes = univers.filter((entry) => entry.tags.includes("monde"));
const vdvs = univers.filter((entry) => entry.tags.includes("vdv"));
const inventory = univers.filter((entry) => entry.tags.includes("inventory"));

const formResult = {
  skills: {},
  characteristics: {
    corps: 0,
    dexterite: 0,
    influence: 0,
    savoir: 0,
  },
};

/**
 * Calculates the inventory budget based on the dexterity characteristic level.
 * @param {number} dexterite - The dexterity level (from -2 to 4).
 * @returns {number} The corresponding inventory budget.
 * @throws {Error} If the dexterity level is outside the handled range.
 */
function dexteriteToInventoryBudget(dexterite) {
  switch (dexterite) {
    case -2:
      return 0;
    case -1:
      return 0;
    case 0:
      return 1;
    case 1:
      return 2;
    case 2:
      return 3;
    case 3:
      return 4;
    case 4:
      return 5;
    default:
      throw new Error("dexeterite " + dexterite + "not handled");
  }
}

const characterNameInputElement = /** @type {HTMLElement} */ (
  document.querySelector(".character-name__input")
);

characterNameInputElement.addEventListener("input", (e) => {
  formResult.name = e.target.value;
});

const /** @type {Skill[]} */ skills = univers
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

      const requirementTag = skill.tags.find((/** @type {string} */ tag) =>
        tag.startsWith("require:"),
      );

      let /** @type {string | null} */ requirementType;
      let /** @type {UniversEntry | null} */ requirementEntry;

      if (requirementTag) {
        const requirementParts = requirementTag.split(":");
        requirementType = requirementParts[1];

        switch (requirementType) {
          case "vdv":
            requirementEntry = vdvs.find(
              (vdv) => vdv.key === requirementParts[2],
            );
            break;
          case "race":
            requirementEntry = races.find(
              (race) => race.key === requirementParts[2],
            );
            break;
          default:
            throw new Error("unknown requirement " + requirementParts);
        }
      }

      return {
        levels,
        rankMax: levels.length,
        requirementType: requirementType,
        requirementEntry: requirementEntry,
        availableToSorcerer:
          skill.tags.findIndex((tag) => tag === "available-to-sorcerer") !== -1,
        ...skill,
      };
    });

const characteristics = univers
  .filter((entry) => entry.tags.includes("characteristic"))
  .map((characteristic) => {
    const levels = univers
      .filter((entry) =>
        entry.tags.includes("characteristic:" + characteristic.key),
      )
      .map((level) => {
        const rank = level.tags
          .find((tag) => tag.startsWith("level:"))
          ?.split(":")[1];

        if (!rank) {
          throw new Error("missing rank on " + level.toString());
        }

        // Extract pc tag if it exists
        const pcTag = level.tags.find((tag) => tag.startsWith("pc:"));
        const pcValue = pcTag ? parseInt(pcTag.split(":")[1]) : null;

        return { rank: parseInt(rank), pcValue, ...level };
      });

    return { levels, ...characteristic };
  });

let characteristicBudget = CHARACTERISTIC_BUDGET;
let skillBudget = SKILL_BUDGET;
let inventoryBudget = dexteriteToInventoryBudget(
  formResult.characteristics.dexterite,
);

const budgetElement = /** @type {HTMLElement} */ (
  document.querySelector(".skills__budget")
);
const budgetCounterElement = /** @type {HTMLElement} */ (
  document.querySelector(".skills__budget__counter")
);
budgetCounterElement.textContent = skillBudget + "";

const inventoryBudgetElement = /** @type {HTMLElement} */ (
  document.querySelector(".inventory__budget")
);
const inventoryBudgetCounterElement = /** @type {HTMLElement} */ (
  document.querySelector(".inventory__budget__counter")
);
inventoryBudgetCounterElement.textContent = inventoryBudget + "";

// Extract the default PC value from savoir characteristic level 0
const savoirCharacteristic = characteristics.find(
  (char) => char.key === "savoir",
);
const defaultSavoirLevel = savoirCharacteristic?.levels.find(
  (level) => level.rank === 0,
);
const defaultSavoirPcValue = defaultSavoirLevel?.pcValue || 0; // Fallback to 1 if not found

const characteristicsSelect = document.querySelector(".characteristics");
const characteristicBudgetElement = document.querySelector(
  ".characteristics__budget",
);

characteristics.forEach((characteristic) => {
  const characteristicF = characteristic;
  let lvl = 0;
  let previousLvl = 0;
  let previousPcValue =
    characteristic.key === "savoir" ? defaultSavoirPcValue : null; // Initialize with default PC value for savoir

  const clone = characteristicTemplate.content.cloneNode(true);

  const print = (/** @type {Element} */ el) => {
    const characteristicDesc = characteristicF.levels[lvl + 2];
    const labelElement = /** @type {HTMLElement} */ (
      el.querySelector(".characteristic__label")
    );
    const descriptionElement = /** @type {HTMLElement} */ (
      el.querySelector(".characteristic__description")
    );

    const inputElement = /** @type {HTMLElement} */ (
      el.querySelector(".characteristic__input")
    );

    labelElement.textContent = characteristicF.label;
    labelElement.setAttribute("for", characteristicF.key);
    inputElement.setAttribute("name", characteristicF.key);
    descriptionElement.textContent = characteristicDesc.description;
  };

  characteristicsSelect?.appendChild(clone);
  const node = /** @type {Element} */ (characteristicsSelect?.lastElementChild);

  const nodeInput = /** @type {HTMLInputElement} */ (
    node.querySelector(".characteristic__input")
  );

  nodeInput.addEventListener("input", (e) => {
    const targetValue = parseInt(e.target?.value);
    if (isNaN(targetValue)) return;

    // Calculate cost of this change (positive values cost points)
    const pointChange = targetValue - previousLvl;

    // Check if we have enough budget for this change
    if (characteristicBudget - pointChange < 0) {
      // Revert to previous value if not enough budget
      e.target.value = previousLvl.toString();
      return;
    }

    // Apply constraints
    let newLvl = targetValue;
    if (newLvl > 4) {
      newLvl = 4;
      e.target.value = "4";
    }
    if (newLvl < -2) {
      newLvl = -2;
      e.target.value = "-2";
    }

    // Calculate actual point change after constraints
    const actualPointChange = newLvl - previousLvl;

    // Update spent points
    characteristicBudget -= actualPointChange;

    // Update skillBudget if this is the savoir characteristic
    if (characteristic.key === "savoir") {
      // Find the new PC value
      const levelIndex = newLvl + 2; // Adjust for -2 base index
      const newPcValue = characteristicF.levels[levelIndex].pcValue;

      if (newPcValue !== null && previousPcValue !== null) {
        // Calculate the difference in PC points
        const pcDifference = newPcValue - previousPcValue;

        // Update the skill budget
        skillBudget += pcDifference;
        budgetCounterElement.textContent = skillBudget + "";

        // Update button states based on new budget
        updateSkillButtonStates();

        // Store the new PC value for next change
        previousPcValue = newPcValue;
      }
    }

    // Update previousLvl for next change
    previousLvl = newLvl;
    lvl = newLvl;

    formResult.characteristics[characteristic.key] = lvl;

    if (characteristic.key === "dexterite") {
      inventoryBudget = dexteriteToInventoryBudget(
        formResult.characteristics.dexterite,
      );
      inventoryBudgetCounterElement.textContent = inventoryBudget + "";
    }

    // Update budget display
    if (characteristicBudgetElement) {
      characteristicBudgetElement.textContent = `${characteristicBudget}`;
    }

    print(node);
  });

  print(node);
});

/**
 * Update the state of skill up/down buttons based on current budget
 */
function updateSkillButtonStates() {
  if (skillBudget <= 0) {
    document.querySelectorAll(".skill__content__level__up").forEach((el) => {
      el.classList.add("skill__content__level__up--nobudget");
    });
  } else {
    document.querySelectorAll(".skill__content__level__up").forEach((el) => {
      el.classList.remove("skill__content__level__up--nobudget");
    });
  }

  // Update budget text color based on value
  if (skillBudget < 0) {
    budgetElement.classList.add("skills__budget--negative");
  } else {
    budgetElement.classList.remove("skills__budget--negative");
  }
}

// Replace the budget check in onSkillPick with the new function
function onSkillPick(skillKey, rank, cost) {
  skillBudget += cost;

  if (rank > 0) {
    formResult.skills[skillKey] = rank;
  } else {
    delete formResult.skills[skillKey];
  }
  console.log(formResult);
  budgetCounterElement.textContent = skillBudget + "";
  updateSkillButtonStates();
}

/**
 * @typedef {Object} Skill
 * @property {string} key
 * @property {string} label
 * @property {string} description
 * @property {number} rankMax
 * @property {string[]} tags
 * @property {boolean} availableToSorcerer
 * @property {string?} requirementType
 * @property {UniversEntry?} requirementEntry
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

skills.forEach((skill) => {
  let lvl = 0;

  const clone = skillTemplate.content.cloneNode(true);

  // Store skill data (including tags) on the element for filtering
  const skillElement = /** @type {HTMLElement} */ (
    clone.querySelector(".skill")
  );
  if (skillElement && skill.requirementEntry && skill.requirementType) {
    skillElement.dataset.requireType = skill.requirementType;
    skillElement.dataset.requireKey = skill.requirementEntry.key;
  }

  const print = (/** @type {Element} */ el) => {
    const skillDesc = skillBuild(skill, lvl);

    const titleElement = /** @type {HTMLElement} */ (
      el.querySelector(".skill__title")
    );
    const descriptionElement = /** @type {HTMLElement} */ (
      el.querySelector(".skill__content__main__description")
    );
    const levelSpan1Element = /** @type {HTMLElement} */ (
      el.querySelector(".skill__content__level__span1")
    );
    const levelSpan2Element = /** @type {HTMLElement} */ (
      el.querySelector(".skill__content__level__span2")
    );
    const nextLevelElement = /** @type {HTMLElement} */ (
      el.querySelector(".skill__content__main__next-level")
    );

    titleElement.textContent = skillDesc.title;
    descriptionElement.textContent = skillDesc.description;
    levelSpan1Element.textContent = skillDesc.rankDescription;
    levelSpan2Element.textContent = skillDesc.rankTitle;
    nextLevelElement.textContent = skillDesc.nextRankDescription;

    if (lvl === skill.rankMax) {
      el.querySelector(".skill__content__level__up")?.classList.add(
        "skill__content__level__up--max",
      );
    } else {
      el.querySelector(".skill__content__level__up")?.classList.remove(
        "skill__content__level__up--max",
      );
    }

    if (lvl === 0) {
      el.querySelector(".skill__content__level__down")?.classList.add(
        "skill__content__level__down--min",
      );
    } else {
      el.querySelector(".skill__content__level__down")?.classList.remove(
        "skill__content__level__down--min",
      );
    }
  };

  const badgesElement = /** @type {HTMLElement} */ (
    clone.querySelector(".skill__badges")
  );

  if (skill.requirementEntry && skill.requirementType) {
    const badgeElement = document.createElement("span");
    badgeElement.classList.add("skill__badge");
    badgeElement.textContent = skill.requirementEntry.label;
    badgeElement.setAttribute("data-require-type", skill.requirementType);
    badgeElement.setAttribute("data-require-key", skill.requirementEntry.key);

    badgesElement.appendChild(badgeElement);
  }

  if (skill.availableToSorcerer) {
    const badgeElement = document.createElement("span");
    badgeElement.classList.add("skill__badge");
    badgeElement.textContent = "Utilisable avec “Sorts”";
    badgeElement.dataset.availableToSorcerer = "";

    badgesElement.appendChild(badgeElement);
  }

  skillSelect?.appendChild(clone);
  const node = /** @type {Element} */ (skillSelect?.lastElementChild);
  const nodeRankUpElement = /** @type {HTMLElement} */ (
    node.querySelector(".skill__content__level__up")
  );
  const nodeRankDownElement = /** @type {HTMLElement} */ (
    node.querySelector(".skill__content__level__down")
  );

  nodeRankUpElement.addEventListener("click", (e) => {
    if (skillBudget <= 0) {
      return;
    }
    if (lvl < skill.rankMax) {
      lvl++;
      onSkillPick(skill.key, lvl, -skill.levels[lvl - 1].cost);
      print(node);
    }
  });

  nodeRankDownElement.addEventListener("click", (e) => {
    if (lvl > 0) {
      onSkillPick(skill.key, lvl - 1, skill.levels[lvl - 1].cost);
      lvl--;
      print(node);
    }
  });

  print(node);
});

updateSkillList();

// Function to update the visibility of skills based on the selected VDV
function updateSkillList() {
  const skillElements = skillSelect?.querySelectorAll(".skill");
  skillElements?.forEach((el) => {
    if (!el.dataset.requireType || !el.dataset.requireKey) {
      return;
    }

    if (
      formResult[el.dataset.requireType] &&
      formResult[el.dataset.requireType] === el.dataset.requireKey
    ) {
      el.style.display = ""; // Show skill if VDV matches requirement
    } else {
      el.style.display = "none"; // Hide skill if VDV doesn't match or no VDV selected
    }
  });
}

// Store all races for filtering
const allRaces = [...races];
// Store all vdvs for filtering
const allVdvs = [...vdvs];

inventory.forEach((item) => {
  const clone = inventoryItemTemplate.content.cloneNode(true);

  const titleElement = clone.querySelector(
    ".inventory__select__option__content__title",
  );
  const descriptionElement = clone.querySelector(
    ".inventory__select__option__content__description",
  );

  const costElement = clone.querySelector(
    ".inventory__select__option__picker__cost",
  );

  titleElement.textContent = item.label;
  descriptionElement.textContent = item.description;

  const cost = item.tags.find((tag) => tag.startsWith("cost:"))?.split(":")[1];
  costElement.textContent = cost + (cost === "1" ? " gemme" : " gemmes");

  inventorySelect?.appendChild(clone);
});

mondes.forEach((monde) => {
  const clone = mondeTemplate.content.cloneNode(true);

  const titleElement = clone.querySelector(".group__select__option__title");
  const liElement = clone.querySelector("li");
  const descriptionElement = clone.querySelector(
    ".group__select__option__description",
  );

  titleElement.textContent = monde.label;
  descriptionElement.textContent = monde.description;
  liElement.setAttribute("data-key", monde.key);

  mondeSelect?.appendChild(clone);
});

/**
 * Attach click listeners to a list of selectable elements
 * @param {NodeListOf<Element> | Element[]} elements - List elements to attach listeners to
 * @param {string} formKey - Key to use in formResult object
 */
function attachSelectListeners(elements, formKey) {
  const sectionElement = document.querySelector("." + formKey);
  const selectedSectionElement =
    sectionElement?.querySelector(".selected-section");

  elements.forEach((li, i) => {
    li.addEventListener("click", function (e) {
      const currentTarget = /** @type {Element} */ (e.currentTarget);
      let classes = currentTarget.getAttribute("class")?.split(" ") || [];

      const index = classes.indexOf("selected");
      if (index !== -1) {
        classes.splice(index, 1);
        delete formResult[formKey];

        updateSkillList();
        console.log(formResult);

        // If the section as a selected-section element, empty it.
        if (selectedSectionElement) {
          selectedSectionElement.textContent = "";
        }
      } else {
        classes.push("selected");
        formResult[formKey] = li.getAttribute("data-key");

        updateSkillList();
        console.log(formResult);

        // If the section as a selected-section element, display the user choice there.
        if (selectedSectionElement) {
          const optionName = li.querySelector(
            "." + formKey + "__select__option__title",
          )?.textContent;
          selectedSectionElement.textContent = optionName || "";

          sectionElement?.removeAttribute("open");
        }

        // Deselect all other elements in this group
        elements.forEach((li2, j) => {
          if (i === j) return;
          let classes = li2.getAttribute("class")?.split(" ") || [];
          const index = classes.indexOf("selected");
          if (index !== -1) classes.splice(index, 1);

          li2.setAttribute("class", classes.join(" "));
        });
      }

      currentTarget.setAttribute("class", classes.join(" "));
    });
  });
}

allRaces.forEach((race) => {
  const clone = raceTemplate.content.cloneNode(true);

  const titleElement = clone.querySelector(".race__select__option__title");
  const liElement = clone.querySelector("li");
  const descriptionElement = clone.querySelector(
    ".race__select__option__description",
  );
  const mondeBadgeElement = clone.querySelector(".monde-badge");

  titleElement.textContent = race.label;
  descriptionElement.textContent = race.description;
  liElement.setAttribute("data-key", race.key);
  mondeBadgeElement.textContent = mondes.find(
    (monde) =>
      monde.key ===
      race.tags.find((tag) => tag.startsWith("monde:"))?.split(":")[1],
  )?.label;

  // Add a data attribute for the monde key (useful for styling)
  liElement.setAttribute(
    "data-monde",
    mondes.find(
      (monde) =>
        monde.key ===
        race.tags.find((tag) => tag.startsWith("monde:"))?.split(":")[1],
    )?.key,
  );

  raceSelect?.appendChild(clone);
});

allVdvs.forEach((vdv) => {
  const clone = vdvTemplate.content.cloneNode(true);

  const titleElement = clone.querySelector(".vdv__select__option__title");
  const liElement = clone.querySelector("li");
  const descriptionElement = clone.querySelector(
    ".vdv__select__option__description",
  );
  const mondeBadgeElement = clone.querySelector(".monde-badge");

  titleElement.textContent = vdv.label;
  descriptionElement.textContent = vdv.description;
  liElement.setAttribute("data-key", vdv.key);
  mondeBadgeElement.textContent = mondes.find(
    (monde) =>
      monde.key ===
      vdv.tags.find((tag) => tag.startsWith("monde:"))?.split(":")[1],
  )?.label;

  // Add a data attribute for the monde key (useful for styling)
  liElement.setAttribute(
    "data-monde",
    mondes.find(
      (monde) =>
        monde.key ===
        vdv.tags.find((tag) => tag.startsWith("monde:"))?.split(":")[1],
    )?.key,
  );

  vdvSelect?.appendChild(clone);
});

/**
 * Filter races based on the selected monde
 * @param {string?} mondeKey - The key of the selected monde
 */
function filterRacesAndVdvsByMonde(mondeKey) {
  const elements = document.querySelectorAll("li[data-monde]");

  elements?.forEach((el) => {
    if (el.dataset.monde === mondeKey) {
      el.style.display = ""; // Show skill if VDV matches requirement
    } else {
      el.style.display = "none"; // Hide skill if VDV doesn't match or no VDV selected
    }
  });
}

//filterRacesAndVdvsByMonde('erenthyrm');

const matches = document.querySelectorAll(".q-select--unique");
matches.forEach(function (match) {
  const label = match.querySelector("label");
  const lis = match.querySelectorAll("li");

  const forAttribute = label?.getAttribute("for");
  if (forAttribute) {
    attachSelectListeners(lis, forAttribute);
  }
});
