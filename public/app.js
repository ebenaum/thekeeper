// @ts-check

// @ts-ignore
import * as jose from "jose";
// @ts-ignore
import { create, toJson, toBinary, fromBinary } from "@bufbuild/protobuf";
import { EventsSchema } from "./event_pb.js";

const CHARACTERISTIC_BUDGET = 4;
const SKILL_BUDGET = 4;

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

/**
 *
 * @param {string} classes
 * @param {string} classe
 * @returns {string}
 */
function addClass(classes, classe) {
  const classesArray = classes.split(" ");
  if (classesArray.indexOf(classe) === -1) {
    classesArray.push(classe);
  }

  return classesArray.join(" ");
}

/**
 *
 * @param {string} classes
 * @param {string} classe
 * @returns {string}
 */
function removeClass(classes, classe) {
  const classesArray = classes.split(" ");
  if (classesArray.indexOf(classe) !== -1) {
    classesArray.splice(classesArray.indexOf(classe), 1);
  }

  return classesArray.join(" ");
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
const mondes = univers.filter((entry) => entry.tags.includes("monde"));
const vdvs = univers.filter((entry) => entry.tags.includes("voie-de-vie"));

const formResult = { skills: {}, characteristics: {} };

const characterNameInputElement = /** @type {HTMLElement} */ (
  document.querySelector(".character-name__input")
);

characterNameInputElement.addEventListener("input", (e) => {
  formResult.name = e.target.value;
});

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

const budgetElement = /** @type {HTMLElement} */ (
  document.querySelector(".skills__budget")
);
const budgetCounterElement = /** @type {HTMLElement} */ (
  document.querySelector(".skills__budget__counter")
);
budgetCounterElement.textContent = skillBudget + "";

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
  let lvl = 0;

  const clone = skillTemplate.content.cloneNode(true);

  const print = (/** @type {Element} */ el) => {
    const skillDesc = skillBuild(skill, lvl);

    const titleElement = /** @type {HTMLElement} */ (
      el.querySelector(".skill__title")
    );
    const descriptionElement = /** @type {HTMLElement} */ (
      el.querySelector(".skill__content__description")
    );
    const levelSpan1Element = /** @type {HTMLElement} */ (
      el.querySelector(".skill__content__level__span1")
    );
    const levelSpan2Element = /** @type {HTMLElement} */ (
      el.querySelector(".skill__content__level__span2")
    );
    const nextLevelElement = /** @type {HTMLElement} */ (
      el.querySelector(".skill__content__next-level")
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

const mondeSelect = document.querySelector(".group__select");
// Store all races for filtering
const allRaces = [...races];
// Store all vdvs for filtering
const allVdvs = [...vdvs];

mondes.forEach((monde) => {
  const clone = /** @type {DocumentFragment} */ (
    mondeTemplate.content.cloneNode(true)
  );

  const titleElement = /** @type {HTMLElement} */ (
    clone.querySelector(".group__select__option__title")
  );
  const liElement = /** @type {HTMLElement} */ (clone.querySelector("li"));
  const descriptionElement = /** @type {HTMLElement} */ (
    clone.querySelector(".group__select__option__description")
  );

  titleElement.textContent = monde.label;
  descriptionElement.textContent = monde.description;
  liElement.setAttribute("data-key", monde.key);

  // Add event listener to filter races on monde selection
  liElement.addEventListener("click", function () {
    // Check if this monde is being selected or deselected
    const isSelected = liElement.classList.contains("selected");

    document.querySelectorAll(".dependency-monde").forEach((el) => {
      const selectedElement = el.querySelector(".selected-section");
      if (selectedElement) {
        selectedElement.textContent = "";
      }
    });

    if (isSelected) {
      displayPickAWorldPlaceholders();

      document.querySelectorAll(".dependency-monde").forEach((el) => {
        el.removeAttribute("open");
        delete formResult[el.querySelector("label")?.getAttribute("for")];
      });
    } else {
      document.querySelectorAll(".dependency-monde").forEach((el) => {
        el.setAttribute("open", "");
      });

      // If selected, filter races based on selected monde
      const mondeKey = monde.key;
      filterRacesAndVdvsByMonde(mondeKey);
    }
  });

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
      let classes =
        /** @type {Element} */ (e.currentTarget)
          .getAttribute("class")
          ?.split(" ") || [];

      const index = classes.indexOf("selected");
      if (index !== -1) {
        classes.splice(index, 1);
        delete formResult[formKey];
        console.log(formResult);

        // If the section as a selected-section element, empty it.
        if (selectedSectionElement) {
          selectedSectionElement.textContent = "";
        }
      } else {
        classes.push("selected");
        formResult[formKey] = li.getAttribute("data-key");
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

      /** @type {Element} */ (e.currentTarget).setAttribute(
        "class",
        classes.join(" "),
      );
    });
  });
}

/**
 * Filter races based on the selected monde
 * @param {string} mondeKey - The key of the selected monde
 */
function filterRacesAndVdvsByMonde(mondeKey) {
  // Clear race selections
  document.querySelectorAll(".dependency-monde").forEach((el) => {
    const selected = el.querySelector(".selected");
    if (selected) {
      selected.classList.remove("selected");
    }

    const ulElement = el.querySelector(".q-response-select");
    if (ulElement) {
      ulElement.innerHTML = "";
    }
  });

  // Find the selected monde's label
  const selectedMonde = mondes.find((monde) => monde.key === mondeKey);
  const mondeLabel = selectedMonde ? selectedMonde.label : mondeKey;

  // Filter races and vdvs that match the monde key in their tags
  const filteredRaces = allRaces.filter((race) => race.tags.includes(mondeKey));
  const filteredVdvs = allVdvs.filter((vdv) => vdv.tags.includes(mondeKey));

  // Populate race select with filtered races
  filteredRaces.forEach((race) => {
    const clone = /** @type {DocumentFragment} */ (
      raceTemplate.content.cloneNode(true)
    );

    const titleElement = /** @type {HTMLElement} */ (
      clone.querySelector(".race__select__option__title")
    );
    const liElement = /** @type {HTMLElement} */ (clone.querySelector("li"));
    const descriptionElement = /** @type {HTMLElement} */ (
      clone.querySelector(".race__select__option__description")
    );
    const mondeBadgeElement = /** @type {HTMLElement} */ (
      clone.querySelector(".monde-badge")
    );

    titleElement.textContent = race.label;
    descriptionElement.textContent = race.description;
    liElement.setAttribute("data-key", race.key);
    mondeBadgeElement.textContent = mondeLabel;

    // Add a data attribute for the monde key (useful for styling)
    liElement.setAttribute("data-monde", mondeKey);

    raceSelect?.appendChild(clone);
  });

  // Attach listeners to the new race options
  const raceList = raceSelect?.querySelectorAll("li");
  if (raceList) {
    attachSelectListeners(raceList, "race");
  }

  // Populate vdv select with filtered vdv
  filteredVdvs.forEach((vdv) => {
    const clone = /** @type {DocumentFragment} */ (
      vdvTemplate.content.cloneNode(true)
    );

    const titleElement = /** @type {HTMLElement} */ (
      clone.querySelector(".vdv__select__option__title")
    );
    const liElement = /** @type {HTMLElement} */ (clone.querySelector("li"));
    const descriptionElement = /** @type {HTMLElement} */ (
      clone.querySelector(".vdv__select__option__description")
    );
    const mondeBadgeElement = /** @type {HTMLElement} */ (
      clone.querySelector(".monde-badge")
    );

    titleElement.textContent = vdv.label;
    descriptionElement.textContent = vdv.description;
    liElement.setAttribute("data-key", vdv.key);
    mondeBadgeElement.textContent = mondeLabel;

    // Add a data attribute for the monde key (useful for styling)
    liElement.setAttribute("data-monde", mondeKey);

    vdvSelect?.appendChild(clone);
  });

  // Attach listeners to the new vdv options
  const vdvList = vdvSelect?.querySelectorAll("li");
  if (vdvList) {
    attachSelectListeners(vdvList, "vdv");
  }
}

// Initial race select setup - show placeholder message
const raceSelect = document.querySelector(".race__select");
// Initial race select setup - show placeholder message
const vdvSelect = document.querySelector(".vdv__select");

function displayPickAWorldPlaceholders() {
  document.querySelectorAll(".dependency-monde").forEach((el) => {
    const select = el.querySelector(".q-response-select");

    if (select) {
      select.innerHTML = "";
      // Create and add placeholder message
      const placeholderElement = document.createElement("div");
      placeholderElement.textContent =
        "Veuillez d'abord sélectionner un monde pour voir les choix disponibles";

      select.appendChild(placeholderElement);
    }
  });
}

displayPickAWorldPlaceholders();

const matches = document.querySelectorAll(".q-select--unique");
matches.forEach(function (match) {
  const label = match.querySelector("label");
  const lis = match.querySelectorAll("li");

  const forAttribute = label?.getAttribute("for");
  if (forAttribute) {
    attachSelectListeners(lis, forAttribute);
  }
});
