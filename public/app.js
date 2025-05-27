// @ts-check

// @ts-ignore
import * as jose from "jose";
// @ts-ignore
import { create, toJson, toBinary, fromBinary } from "@bufbuild/protobuf";
import { EventsSchema } from "./event_pb.js";
import { EventPlayerPersonSchema } from "./player_person_pb.js";
import { EventPlayerCharacterSchema } from "./player_character_pb.js";

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
    handle: "",
    players: {},
    characters: {},
  };
}

/**
 * Generates an ES256 key pair using the jose library.
 * The generated keys are marked as extractable.
 * @returns {Promise<KeyEntry>} A promise that resolves to the generated key pair.
 */
async function generateKeypair() {
  const keypair = await jose.generateKeyPair("ES256", { extractable: true });

  return { public: keypair.publicKey, private: keypair.privateKey };
}

/**
 *
 * @param {KeyEntry} keypair
 */
async function storeKeypair(keypair) {
  const keysEntry = {
    public: await window.crypto.subtle.exportKey("jwk", keypair.public),
    private: await window.crypto.subtle.exportKey("jwk", keypair.private),
  };

  localStorage.setItem("keys", JSON.stringify(keysEntry));
}

/**
 * @typedef {Object} KeyEntry
 * @property {CryptoKey} public
 * @property {CryptoKey} private
 */

/**
 *
 * @returns {Promise<State>}
 */
async function init() {
  const keypair = await generateKeypair();
  const handle = createRandomString(16);

  console.log(
    `no keypair, generate new one: ${buf2hex(await window.crypto.subtle.exportKey("raw", keypair.public))}`,
  );

  const seed = create(EventsSchema, {
    events: [
      {
        msg: {
          case: "SeedActor",
          value: {
            handle: handle,
          },
        },
      },
    ],
  });

  const response = await fetch(`${globalThis.env.thekeeperURL}/state`, {
    method: "POST",
    headers: {
      Authorization: await auth(keypair.private, keypair.public),
      "Content-Type": "application/x-protobuf",
    },
    body: toBinary(EventsSchema, seed),
  });

  const jsonResponse = await response.json();
  if (jsonResponse[0].error) {
    throw jsonResponse[0].error;
  }

  const state = {
    keys: keypair,
    data: newData(),
    cursor: -1,
  };

  storeKeypair(keypair);
  await sync(state, true);

  return state;
}

/**
 * @typedef {Object} UniversEntry
 * @property {string} key
 * @property {string[]} tags
 * @property {string} label
 * @property {string?} img
 * @property {string} description
 */

/**
 * @typedef {Object} InformationsForm
 * @property {string}   surname
 * @property {string}   age
 * @property {string}   cityOfOrigin
 * @property {string}   contact
 * @property {boolean}  approvedConditions
 * @property {string}   emergencyContact
 * @property {string}   health
 * @property {string}   peopleToPlayWith
 * @property {string}   skills
 * @property {string}   useExistingCharacter
 * @property {string}   existingCharacterAchievements
 * @property {string}   gameStyle
 * @property {string[]} gameStyleTags
 * @property {string}   situationToAvoid
 * @property {string}   inscriptionType
 * @property {boolean}  pictureRights
 */

/**
 * @typedef {Object} Characteristics
 * @property {number} corps
 * @property {number} dexterite
 * @property {number} influence
 * @property {number} savoir
 */

/**
 * @typedef {Object} CharacterForm
 * @property {string}                 playerId
 * @property {string}                 name
 * @property {string}                 group
 * @property {string}                 worldOrigin
 * @property {string}                 worldApproach
 * @property {string}                 vdv
 * @property {string}                 race
 * @property {Object.<string,number>} skills
 * @property {Object.<string,number>} inventory
 * @property {Characteristics}        characteristics
 * @property {string}                 description
 */

/**
 * @typedef {Object} Data
 * @property {Object.<string, {handle: string, personal?: InformationsForm, characters: string[]}>} players
 * @property {Object.<string, CharacterForm>} characters
 * @property {string} handle
 * @property {string} [permission]
 */

/**
 * @typedef {Object} State
 * @property {Data} data
 * @property {number} cursor
 * @property {KeyEntry} keys
 */

/**
 *
 * @returns {Promise<State|null>}
 */
async function getState() {
  const keys = JSON.parse(/** @type {string} */ (localStorage.getItem("keys")));
  const cursor = Number(/** @type {string} */ (localStorage.getItem("cursor")));

  const data = JSON.parse(/** @type {string} */ (localStorage.getItem("data")));

  if (!keys) {
    return null;
  }

  const state = {
    data: data,
    cursor: cursor,
    keys: {
      private: await window.crypto.subtle.importKey(
        "jwk",
        keys.private,
        { name: "ECDSA", namedCurve: "P-256" },
        false,
        ["sign"],
      ),
      public: await window.crypto.subtle.importKey(
        "jwk",
        keys.public,
        { name: "ECDSA", namedCurve: "P-256" },
        true,
        ["verify"],
      ),
    },
  };

  console.log(
    `keypair exists: ${buf2hex(await window.crypto.subtle.exportKey("raw", state.keys.public))}`,
  );

  await sync(state, false);

  return state;
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

  const response = await fetch(
    `${globalThis.env.thekeeperURL}/state?from=` + cursor,
    {
      method: "GET",
      headers: {
        Authorization: await auth(state.keys.private, state.keys.public),
      },
    },
  );

  const msg = await fromBinary(
    EventsSchema,
    new Uint8Array(await response.arrayBuffer()),
  );

  msg.events.forEach(
    function (
      /** @type {{ msg: { case: any; value: any; }; ts: number; }} */ event,
    ) {
      processEvent(state.data, event.msg.case, event.msg.value, reset);
      state.cursor = event.ts;
    },
  );

  localStorage.setItem("cursor", state.cursor.toString());
  localStorage.setItem("data", JSON.stringify(state.data));
}

/**
 * @param {Data} data
 * @param {any} eventType
 * @param {any} eventValue
 * @params {boolean} reset
 */
function processEvent(data, eventType, eventValue, reset) {
  switch (eventType) {
    case "SeedPlayer":
      data.players[eventValue.playerId] = {
        handle: eventValue.handle,
        characters: [],
      };

      break;
    case "SeedActor":
      data.handle = eventValue.handle;

      break;
    case "Permission":
      data.permission = eventValue.permission;

      break;
    case "Reset":
      if (!reset) {
        localStorage.setItem("cursor", "-1");
        window.location.href = window.location.href;
        console.log("reset");
      } else {
        console.log("alreayd resetting, ignoring reset");
      }

      break;
    case "PlayerPerson":
      data.players[eventValue.playerId].personal = toJson(
        EventPlayerPersonSchema,
        eventValue,
        { alwaysEmitImplicit: true },
      );

      break;
    case "PlayerCharacter":
      data.characters[eventValue.characterId] = toJson(
        EventPlayerCharacterSchema,
        eventValue,
        {
          alwaysEmitImplicit: true,
        },
      );

      if (
        data.players[eventValue.playerId].characters.indexOf(
          eventValue.characterId,
        ) === -1
      ) {
        data.players[eventValue.playerId].characters.push(
          eventValue.characterId,
        );
      }

      break;
    default:
      console.log(`unknown event ${eventType} ${eventValue}`);
  }
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
    .setExpirationTime("30s")
    .sign(privateKey);
}

/**
 * @callback attachSelectListenersCallback
 * @param {'select'|'unselect'} op
 * @param {string} key
 * @param {string} value
 */

/**
 * Attach click listeners to a list of selectable elements
 * @param {NodeListOf<Element> | Element[]} elements - List elements to attach listeners to
 * @param {string} formKey - Key to use in formResult object$
 * @param {boolean} allowMultiple
 * @param {attachSelectListenersCallback} callback
 */
function attachSelectListeners(elements, formKey, allowMultiple, callback) {
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
        callback("unselect", formKey, li.getAttribute("data-key"));

        // If the section as a selected-section element, empty it.
        if (selectedSectionElement) {
          selectedSectionElement.textContent = "";
        }
      } else {
        classes.push("selected");
        callback("select", formKey, li.getAttribute("data-key"));

        // If the section as a selected-section element, display the user choice there.
        if (selectedSectionElement) {
          const optionName = li.querySelector(
            `.${formKey}__select__option__title`,
          )?.textContent;
          selectedSectionElement.textContent = optionName || "";

          sectionElement?.removeAttribute("open");
        }

        if (!allowMultiple) {
          // Deselect all other elements in this group
          elements.forEach((li2, j) => {
            if (i === j) return;
            let classes = li2.getAttribute("class")?.split(" ") || [];
            const index = classes.indexOf("selected");
            if (index !== -1) classes.splice(index, 1);

            li2.setAttribute("class", classes.join(" "));
          });
        }
      }

      currentTarget.setAttribute("class", classes.join(" "));
    });
  });
}

/**
 *
 * @param {CharacterForm} player
 * @param {Object<string, UniversEntry>} univers
 */
async function personnage_orga(player, characteristicsLevels, univers) {
  const containerElement = document.querySelector(".container");
  if (!containerElement) {
    throw new Error("no container element");
  }

  /** @type {HTMLTemplateElement | null} */
  const orgaTemplate = document.querySelector("#template__orga");
  if (!orgaTemplate) {
    throw new Error("cannot retrieve orga template");
  }

  containerElement.querySelectorAll("details").forEach((el) => {
    el.removeAttribute("open");
  });

  const clone = orgaTemplate.content.cloneNode(true);

  const print = (/** @type {Element} */ el) => {
    const titleElement = /** @type {HTMLElement} */ (
      el.querySelector(".orga__player-title")
    );

    const raceVdvElement = /** @type {HTMLElement} */ (
      el.querySelector(".orga__player-race-vdv")
    );

    const characteristicsElement = /** @type {HTMLElement} */ (
      el.querySelector(".orga__player-characteristics")
    );

    titleElement.innerHTML = `<span class="orga__player-title__name">${player.name}</span> | ${univers[player.group]?.label || "Sans monde"} | ${univers[player.worldOrigin]?.label || "Sans status"} | ${univers[player.worldApproach]?.label || "Sans alignement"}`;
    raceVdvElement.textContent = `${univers[player.race]?.label || "Sans race"} | ${univers[player.vdv]?.label || "Sans Voie de Vie"}`;
    const characteristics = [];

    Object.keys(player.characteristics).forEach((characteristic) => {
      console.log(
        characteristicsLevels.find((c) => c.key === characteristic)?.levels,
      );

      characteristics.push(
        `${univers[characteristic].label} : ${characteristicsLevels.find((c) => c.key === characteristic)?.levels[player.characteristics[characteristic] + 2]?.description} (${player.characteristics[characteristic]})`,
      );
    });

    characteristicsElement.textContent = characteristics.join(" | ");
  };

  containerElement?.prepend(clone);
  const node = /** @type {Element} */ (containerElement?.firstElementChild);

  print(node);
}

async function personnage() {
  let state = await getState();

  const url = new URL(window.location.href);
  const characterId = url.searchParams.get("characterId");
  let playerId = url.searchParams.get("playerId");

  let /** @type{CharacterForm} */ formResult = {
      playerId: "",
      name: "",
      group: "",
      vdv: "",
      race: "",
      skills: {},
      inventory: {},
      worldApproach: "",
      worldOrigin: "",
      description: "",
      characteristics: {
        corps: 0,
        dexterite: 0,
        influence: 0,
        savoir: 0,
      },
    };

  if ((characterId || playerId) && !state) {
    window.location.href = "/personnage.html";
    return;
  }

  if (state && characterId) {
    if (state.data.characters[characterId]) {
      formResult = state.data.characters[characterId];
      playerId = formResult.playerId;
    } else {
      window.location.href = "/personnage.html";
      return;
    }
  }

  /* TEMPLATES */
  /** @type {HTMLTemplateElement | null} */
  const mondeTemplate = document.querySelector("#template__group-option");
  if (!mondeTemplate) {
    throw new Error("cannot retrieve monde template");
  }

  /** @type {HTMLTemplateElement | null} */
  const worldOriginTemplate = document.querySelector(
    "#template__worldOrigin-option",
  );
  if (!worldOriginTemplate) {
    throw new Error("cannot retrieve worldOrigin template");
  }

  /** @type {HTMLTemplateElement | null} */
  const worldApproachTemplate = document.querySelector(
    "#template__worldApproach-option",
  );
  if (!worldApproachTemplate) {
    throw new Error("cannot retrieve worldOrigin template");
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
  const originSelect = document.querySelector(".worldOrigin__select");
  const approachSelect = document.querySelector(".worldApproach__select");
  const vdvSelect = document.querySelector(".vdv__select");
  const skillSelect = document.querySelector(".skills");
  const inventorySelect = document.querySelector(".inventory__select");

  const universResponse = await fetch(globalThis.env.univers);
  const /** @type {UniversEntry[]} */ univers = await universResponse.json();
  const races = univers.filter((entry) => entry.tags.includes("race"));
  const mondes = univers.filter((entry) => entry.tags.includes("monde"));
  const origins = univers.filter((entry) =>
    entry.tags.includes("world-of-origin"),
  );
  const approachs = univers.filter((entry) => entry.tags.includes("approach"));
  const vdvs = univers.filter((entry) => entry.tags.includes("vdv"));
  const inventory = univers.filter((entry) => entry.tags.includes("inventory"));

  const /** @type{Object<string, UniversEntry>} */ universMap = {};
  univers.forEach((entry) => {
    universMap[entry.key] = entry;
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

  if (state?.data.permission === "orga") {
    await personnage_orga(formResult, characteristics, universMap);
  }

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
        throw new Error("dexterite " + dexterite + "not handled");
    }
  }

  const characterNameInputElement = /** @type {HTMLInputElement} */ (
    document.querySelector(".character-name__input")
  );

  characterNameInputElement.addEventListener("input", (e) => {
    formResult.name = /** @type{HTMLInputElement}*/ (e.target)?.value;
  });

  characterNameInputElement.value = formResult.name;

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

        let /** @type {string | null} */ requirementType = null;
        let /** @type {UniversEntry | null} */ requirementEntry = null;

        if (requirementTag) {
          const requirementParts = requirementTag.split(":");
          requirementType = requirementParts[1];

          switch (requirementType) {
            case "vdv":
              requirementEntry =
                vdvs.find((vdv) => vdv.key === requirementParts[2]) || null;
              break;
            case "race":
              requirementEntry =
                races.find((race) => race.key === requirementParts[2]) || null;
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
            skill.tags.findIndex((tag) => tag === "available-to-sorcerer") !==
            -1,
          ...skill,
        };
      })
      .sort((a, b) => {
        if (a.key < b.key) {
          return -1;
        }

        if (b.key < a.key) {
          return 1;
        }
        return 0;
      });

  let characteristicBudget =
    parseInt(
      univers
        .find((entry) => entry.key === "characteristics-default-points")
        ?.tags.find((tag) => tag.startsWith("n:"))
        ?.split(":")[1] || "0",
    ) -
    Object.values(formResult.characteristics).reduce(
      (acc, cur) => acc + cur,
      0,
    );

  // Extract the default PC value from savoir characteristic level 0
  const savoirCharacteristic = characteristics.find(
    (char) => char.key === "savoir",
  );
  const defaultSavoirLevel = savoirCharacteristic?.levels.find(
    (level) => level.rank === formResult.characteristics.savoir,
  );

  const defaultSavoirPcValue = defaultSavoirLevel?.pcValue || 0; // Fallback to 1 if not found

  let skillBudget =
    parseInt(
      univers
        .find((entry) => entry.key === "skills-default-points")
        ?.tags.find((tag) => tag.startsWith("n:"))
        ?.split(":")[1] || "0",
    ) -
    Object.keys(formResult.skills).reduce((acc, cur) => {
      const lvls = skills.find((skill) => skill.key === cur)?.levels;

      if (!lvls) {
        return acc;
      }

      let cost = 0;

      for (let i = 0; i < formResult.skills[cur]; i++) {
        cost += lvls[i].cost;
      }

      return acc + cost;
    }, 0) +
    defaultSavoirPcValue;

  const characteristicsSelect = document.querySelector(".characteristics");
  const characteristicBudgetElement = /** @type {HTMLElement} */ (
    document.querySelector(".characteristics__budget")
  );

  characteristicBudgetElement.textContent = `${characteristicBudget}`;

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

  characteristics.forEach((characteristic) => {
    const characteristicF = characteristic;
    let lvl = formResult.characteristics[characteristic.key] || 0;
    let previousLvl = formResult.characteristics[characteristic.key] || 0;
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

      const inputElement = /** @type {HTMLInputElement} */ (
        el.querySelector(".characteristic__input")
      );

      inputElement.value = lvl.toString();

      labelElement.textContent = characteristicF.label;
      labelElement.setAttribute("for", characteristicF.key);
      inputElement.setAttribute("name", characteristicF.key);
      descriptionElement.textContent = characteristicDesc.description;
    };

    characteristicsSelect?.appendChild(clone);
    const node = /** @type {Element} */ (
      characteristicsSelect?.lastElementChild
    );

    const nodeInput = /** @type {HTMLInputElement} */ (
      node.querySelector(".characteristic__input")
    );

    nodeInput.addEventListener("input", (e) => {
      const target = /** @type{HTMLInputElement}*/ (e.target);
      const targetValue = parseInt(target?.value);
      if (isNaN(targetValue)) return;

      // Calculate cost of this change (positive values cost points)
      const pointChange = targetValue - previousLvl;

      // Check if we have enough budget for this change
      if (characteristicBudget - pointChange < 0) {
        // Revert to previous value if not enough budget
        target.value = previousLvl.toString();
        return;
      }

      // Apply constraints
      let newLvl = targetValue;
      if (newLvl > 4) {
        newLvl = 4;
        target.value = "4";
      }
      if (newLvl < -2) {
        newLvl = -2;
        target.value = "-2";
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

      if (characteristic.key === "dexterite") {
        const inventoryBudgetChange =
          dexteriteToInventoryBudget(newLvl) -
          dexteriteToInventoryBudget(previousLvl);

        inventoryBudget += inventoryBudgetChange;
        updateInventoryBudgetState(inventoryBudget);
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
        rank === skill.rankMax || skill.levels.length === 1
          ? null
          : "Rang suivant - Coût " +
            skill.levels[rank].cost +
            " : " +
            skill.levels[rank].description,
      rankTitle: ["", "Novice", "Expert", "Maître"][rank],
    };
  }

  const skillResets = {};

  skills.forEach((skill) => {
    let lvl = formResult.skills[skill.key] || 0;

    const clone = /** @type {HTMLElement} */ (
      skillTemplate.content.cloneNode(true)
    );

    // Store skill data (including tags) on the element for filtering
    const skillElement = /** @type {HTMLElement} */ (
      clone.querySelector(".skill")
    );
    if (skillElement && skill.requirementEntry && skill.requirementType) {
      skillElement.dataset.requireType = skill.requirementType;
      skillElement.dataset.requireKey = skill.requirementEntry.key;
    }

    const print = (
      /** @type {Element} */ el,
      /* @type {boolean}*/ firstPrint,
    ) => {
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

      if (skill.key === "sorts") {
        skillDesc.description = skillDesc.description.replace(
          "SORT BASIQUE",
          `<span class="spellbook">Sort Basique</span>`,
        );

        if (skillDesc.nextRankDescription) {
          skillDesc.nextRankDescription = skillDesc.nextRankDescription.replace(
            "SORT BASIQUE",
            `<span class="spellbook">Sort Basique</span>`,
          );
        }
      }
      descriptionElement.innerHTML = skillDesc.description;

      levelSpan1Element.textContent = skillDesc.rankDescription;
      levelSpan2Element.textContent = skillDesc.rankTitle;
      nextLevelElement.innerHTML = skillDesc.nextRankDescription || "";

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
        el.classList.remove("selected");
        el.querySelector(".skill__content__level__down")?.classList.add(
          "skill__content__level__down--min",
        );
      } else {
        if (!el.classList.contains("selected")) {
          el.classList.add("selected");
          if (!firstPrint) {
            el.scrollIntoView();
          }
        }

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
      badgeElement.textContent = "Sort Basique";
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
        print(node, false);
      }
    });

    nodeRankDownElement.addEventListener("click", (e) => {
      if (lvl > 0) {
        onSkillPick(skill.key, lvl - 1, skill.levels[lvl - 1].cost);
        lvl--;
        print(node, false);
      }
    });

    skillResets[skill.key] = () => {
      let cost = 0;
      for (let i = lvl; i > 0; i--) {
        cost += skill.levels[i - 1].cost;
      }

      onSkillPick(skill.key, 0, cost);
      lvl = 0;
      print(node, false);
    };

    print(node, true);
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

  updateSkillButtonStates();

  // Replace the budget check in onSkillPick with the new function
  function onSkillPick(skillKey, rank, cost) {
    skillBudget += cost;

    if (rank > 0) {
      formResult.skills[skillKey] = rank;
    } else {
      delete formResult.skills[skillKey];
    }

    budgetCounterElement.textContent = skillBudget + "";
    updateSkillButtonStates();
  }

  // Function to update the visibility of skills based on the selected VDV
  function updateSkillList() {
    // Check again the picked skills matches with the race and vdv.
    Object.keys(formResult.skills).forEach((key) => {
      const skill = skills.find((skill) => skill.key === key);
      if (
        skill?.requirementType &&
        formResult[skill.requirementType] !== skill.requirementEntry?.key
      ) {
        skillResets[key]();
      }
    });

    const skillElements = /** @type {NodeListOf<HTMLElement>} */ (
      skillSelect?.querySelectorAll(".skill")
    );
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

  let inventoryBudget =
    dexteriteToInventoryBudget(formResult.characteristics.dexterite) -
    Object.keys(formResult.inventory).reduce((acc, cur) => {
      const cost = parseInt(
        inventory
          .find((item) => item.key === cur)
          ?.tags.find((tag) => tag.startsWith("cost:"))
          ?.split(":")[1] || "0",
      );

      return acc + formResult.inventory[cur] * cost;
    }, 0);

  inventory.forEach((item) => {
    let numberOfItems = formResult.inventory[item.key] || 0;

    const clone = /** @type {HTMLElement} */ (
      inventoryItemTemplate.content.cloneNode(true)
    );

    const cost = parseInt(
      item.tags.find((tag) => tag.startsWith("cost:"))?.split(":")[1] || "0",
    );

    const print = (/** @type {Element} */ el) => {
      const titleElement = /** @type {HTMLElement} */ (
        el.querySelector(".inventory__select__option__content__title")
      );
      const descriptionElement = /** @type {HTMLElement} */ (
        el.querySelector(".inventory__select__option__content__description")
      );
      const costElement = /** @type {HTMLElement} */ (
        el.querySelector(".inventory__select__option__picker__cost")
      );

      const numberElement = /** @type {HTMLElement} */ (
        el.querySelector(".inventory__select__option__picker__control__number")
      );

      titleElement.textContent = item.label;
      descriptionElement.textContent = item.description;
      numberElement.textContent = numberOfItems + "";
      costElement.textContent = cost + (cost === 1 ? " gemme" : " gemmes");

      updateInventoryBudgetState(inventoryBudget);
      updateItemPickerMinusControl(minusElement, numberOfItems);
    };

    inventorySelect?.appendChild(clone);
    const node = /** @type {Element} */ (inventorySelect?.lastElementChild);
    const plusElement = /** @type {HTMLElement} */ (
      node.querySelector(".inventory__select__option__picker__control__plus")
    );
    const minusElement = /** @type {HTMLElement} */ (
      node.querySelector(".inventory__select__option__picker__control__minus")
    );

    plusElement.setAttribute("data-cost", cost.toString());

    plusElement?.addEventListener("click", (e) => {
      if (inventoryBudget - cost < 0) {
        return;
      }
      numberOfItems++;

      inventoryBudget -= cost;

      formResult.inventory[item.key] = numberOfItems;
      print(node);
    });

    minusElement?.addEventListener("click", (e) => {
      if (numberOfItems === 0) {
        return;
      }

      numberOfItems--;

      formResult.inventory[item.key] = numberOfItems;
      if (numberOfItems === 0) {
        delete formResult.inventory[item.key];
      }

      inventoryBudget += cost;
      print(node);
    });

    print(node);
  });

  /**
   * Updates the UI elements related to the inventory budget.
   * - Sets the text content of the inventory budget counter.
   * - Adds/removes a CSS class to indicate a negative budget.
   * - Enables/disables the 'plus' buttons for inventory items based on the budget.
   * @param {number} budget - The current inventory budget value.
   * @returns {void}
   */
  function updateInventoryBudgetState(budget) {
    inventoryBudgetCounterElement.textContent = budget + "";

    if (budget < 0) {
      document
        .querySelector(".inventory__budget")
        ?.classList.add("inventory__budget--negative");
    } else {
      document
        .querySelector(".inventory__budget")
        ?.classList.remove("inventory__budget--negative");
    }

    document
      .querySelectorAll(".inventory__select__option__picker__control__plus")
      .forEach((el) => {
        if (budget - parseInt(el.getAttribute("data-cost") || "0") < 0) {
          el.classList.add(
            "inventory__select__option__picker__control__plus--disabled",
          );
        } else {
          el.classList.remove(
            "inventory__select__option__picker__control__plus--disabled",
          );
        }
      });
  }

  /**
   * Updates the state (enabled/disabled) of the 'minus' control button for an inventory item picker.
   * The button is disabled if the number of items is zero, and enabled otherwise.
   * @param {HTMLElement} el - The 'minus' control button element.
   * @param {number} numberOfItems - The current number of items selected for this inventory item.
   * @returns {void}
   */
  function updateItemPickerMinusControl(el, numberOfItems) {
    if (numberOfItems > 0) {
      el.classList.remove(
        "inventory__select__option__picker__control__minus--disabled",
      );
    } else {
      el.classList.add(
        "inventory__select__option__picker__control__minus--disabled",
      );
    }
  }

  mondes.forEach((monde) => {
    const clone = /** @type {HTMLElement} */ (
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

    mondeSelect?.appendChild(clone);
  });

  origins.forEach((origin) => {
    const clone = /** @type {HTMLElement} */ (
      worldOriginTemplate.content.cloneNode(true)
    );

    const titleElement = /** @type {HTMLElement} */ (
      clone.querySelector(".worldOrigin__select__option__title")
    );
    const liElement = /** @type {HTMLElement} */ (clone.querySelector("li"));
    const descriptionElement = /** @type {HTMLElement} */ (
      clone.querySelector(".worldOrigin__select__option__description")
    );

    titleElement.textContent = origin.label;
    descriptionElement.textContent = origin.description;
    liElement.setAttribute("data-key", origin.key);

    originSelect?.appendChild(clone);
  });

  approachs.forEach((approach) => {
    const clone = /** @type {HTMLElement} */ (
      worldApproachTemplate.content.cloneNode(true)
    );

    const titleElement = /** @type {HTMLElement} */ (
      clone.querySelector(".worldApproach__select__option__title")
    );
    const liElement = /** @type {HTMLElement} */ (clone.querySelector("li"));
    const descriptionElement = /** @type {HTMLElement} */ (
      clone.querySelector(".worldApproach__select__option__description")
    );

    titleElement.textContent = approach.label;
    descriptionElement.textContent = approach.description;
    liElement.setAttribute("data-key", approach.key);

    approachSelect?.appendChild(clone);
  });

  // Store all races for filtering
  const allRaces = [...races];
  // Store all vdvs for filtering
  const allVdvs = [...vdvs];

  allRaces.forEach((race) => {
    const clone = /** @type {HTMLElement} */ (
      raceTemplate.content.cloneNode(true)
    );

    const titleElement = /** @type {HTMLElement} */ (
      clone.querySelector(".race__select__option__title")
    );
    const liElement = /** @type {HTMLElement} */ (clone.querySelector("li"));
    const imgElement = /** @type {HTMLElement} */ (clone.querySelector("img"));
    const contentElement = /** @type {HTMLElement} */ (
      clone.querySelector(".race__select__option__content")
    );
    const descriptionElement = /** @type {HTMLElement} */ (
      clone.querySelector(".race__select__option__description")
    );
    const mondeBadgeElement = /** @type {HTMLElement} */ (
      clone.querySelector(".monde-badge")
    );

    if (race.img) {
      contentElement.setAttribute(
        "style",
        Math.random() > 0.5
          ? "flex-direction: row-reverse"
          : "flex-direction: row",
      );
      imgElement.setAttribute("src", race.img);
      imgElement.setAttribute("style", "margin-top:16px; margin-bottom:16px");
      imgElement.setAttribute("width", "300px");
      imgElement.setAttribute("height", "300px");
      descriptionElement.setAttribute("style", "max-width: 400px");
    }

    titleElement.textContent = race.label;
    descriptionElement.textContent = race.description;
    liElement.setAttribute("data-key", race.key);
    mondeBadgeElement.textContent =
      mondes.find(
        (monde) =>
          monde.key ===
          race.tags.find((tag) => tag.startsWith("monde:"))?.split(":")[1],
      )?.label || "";

    // Add a data attribute for the monde key (useful for styling)
    liElement.setAttribute(
      "data-monde",
      mondes.find(
        (monde) =>
          monde.key ===
          race.tags.find((tag) => tag.startsWith("monde:"))?.split(":")[1],
      )?.key || "",
    );

    raceSelect?.appendChild(clone);
  });

  allVdvs.forEach((vdv) => {
    const clone = /** @type {HTMLElement} */ (
      vdvTemplate.content.cloneNode(true)
    );

    const titleElement = /** @type {HTMLElement} */ (
      clone.querySelector(".vdv__select__option__title")
    );
    const imgElement = /** @type {HTMLElement} */ (clone.querySelector("img"));
    const contentElement = /** @type {HTMLElement} */ (
      clone.querySelector(".vdv__select__option__content")
    );

    const liElement = /** @type {HTMLElement} */ (clone.querySelector("li"));
    const descriptionElement = /** @type {HTMLElement} */ (
      clone.querySelector(".vdv__select__option__description")
    );
    const mondeBadgeElement = /** @type {HTMLElement} */ (
      clone.querySelector(".monde-badge")
    );

    if (vdv.img) {
      contentElement.setAttribute(
        "style",
        Math.random() > 0.5
          ? "flex-direction: row-reverse"
          : "flex-direction: row",
      );
      imgElement.setAttribute("src", vdv.img);
      imgElement.setAttribute("style", "margin-top:16px; margin-bottom:16px");
      imgElement.setAttribute("width", "300px");
      imgElement.setAttribute("height", "300px");
      descriptionElement.setAttribute("style", "max-width: 400px");
    }

    titleElement.textContent = vdv.label;
    descriptionElement.textContent = vdv.description;
    liElement.setAttribute("data-key", vdv.key);
    mondeBadgeElement.textContent =
      mondes.find(
        (monde) =>
          monde.key ===
          vdv.tags.find((tag) => tag.startsWith("monde:"))?.split(":")[1],
      )?.label || "";

    // Add a data attribute for the monde key (useful for styling)
    liElement.setAttribute(
      "data-monde",
      mondes.find(
        (monde) =>
          monde.key ===
          vdv.tags.find((tag) => tag.startsWith("monde:"))?.split(":")[1],
      )?.key || "",
    );

    vdvSelect?.appendChild(clone);
  });

  /**
   * Filter races based on the selected monde
   * @param {string?} mondeKey - The key of the selected monde
   */
  function filterRacesAndVdvsByMonde(mondeKey) {
    const elements = /** @type {NodeListOf<HTMLElement>} */ (
      document.querySelectorAll("li[data-monde]")
    );

    elements?.forEach((el) => {
      if (el.dataset.monde === mondeKey) {
        el.style.display = ""; // Show skill if VDV matches requirement
      } else {
        el.style.display = "none"; // Hide skill if VDV doesn't match or no VDV selected
      }
    });
  }

  updateSkillList();

  document.querySelectorAll(".input-text").forEach(function (match) {
    const label = match.querySelector("label");
    const input =
      match.querySelector("input") || match.querySelector("textarea");

    const forAttribute = label?.getAttribute("for");
    if (!forAttribute || !input) {
      return;
    }

    input.value = formResult[forAttribute] || "";

    match.addEventListener("input", (event) => {
      const target = /** @type{HTMLInputElement}*/ (event.target);
      formResult[forAttribute] = target.value;
    });
  });

  document.querySelectorAll(".q-select--unique").forEach(function (match) {
    const label = match.querySelector("label");
    const lis = match.querySelectorAll("li");
    const selectedSectionElement = match?.querySelector(".selected-section");

    const forAttribute = label?.getAttribute("for");
    if (!forAttribute) {
      return;
    }

    lis.forEach((li) => {
      if (formResult[forAttribute].toString() === li.getAttribute("data-key")) {
        li.classList.add("selected");
        updateSkillList();

        // If the section as a selected-section element, display the user choice there.
        if (selectedSectionElement) {
          const optionName = li.querySelector(
            `.${forAttribute}__select__option__title`,
          )?.textContent;
          selectedSectionElement.textContent = optionName || "";
        }
      }
    });

    attachSelectListeners(lis, forAttribute, false, (op, key, value) => {
      if (op === "select") {
        formResult[key] = value;
      } else {
        delete formResult[key];
      }

      updateSkillList();
    });
  });

  const formElement = document.getElementById("form");

  /**
   *
   * @param {string | null} existingCharacterId
   * @param {string | null} existingPlayerId
   */
  async function submitForm(existingCharacterId, existingPlayerId) {
    const events = [];

    if (!state) {
      state = await init();
    }

    let playerId = existingPlayerId;

    if (!existingPlayerId) {
      playerId = createRandomString(8);
      events.push({
        msg: {
          case: "SeedPlayer",
          value: {
            handle: state.data.handle,
            playerId: playerId,
          },
        },
      });
    }

    let characterId = existingCharacterId;

    if (!existingCharacterId) {
      characterId = createRandomString(8);
    }

    events.push({
      msg: {
        case: "PlayerCharacter",
        value: {
          name: formResult.name,
          characterId: characterId,
          playerId: playerId,
          race: formResult.race,
          vdv: formResult.vdv,
          worldApproach: formResult.worldApproach,
          worldOrigin: formResult.worldOrigin,
          group: formResult.group,
          characteristics: formResult.characteristics,
          skills: formResult.skills,
          description: formResult.description,
          inventory: formResult.inventory,
        },
      },
    });

    const payload = create(EventsSchema, {
      events: events,
    });

    const response = await fetch(`${globalThis.env.thekeeperURL}/state`, {
      method: "POST",
      headers: {
        Authorization: await auth(state.keys.private, state.keys.public),
        "Content-Type": "application/x-protobuf",
      },
      body: toBinary(EventsSchema, payload),
    });

    const jsonResponse = await response.json();
    if (jsonResponse[0].error) {
      throw jsonResponse[0].error;
    }

    window.location.href = "/";
  }

  if (formElement) {
    formElement.onsubmit = function () {
      submitForm(characterId, playerId);

      return false;
    };
  }
}

async function index() {
  const universResponse = await fetch(globalThis.env.univers);
  const /** @type {UniversEntry[]} */ univers = await universResponse.json();

  const universMap = {};
  univers.forEach((entry) => {
    universMap[entry.key] = entry;
  });

  /* TEMPLATES */
  /** @type {HTMLTemplateElement | null} */
  const playerTemplate = document.querySelector("#template__player");
  if (!playerTemplate) {
    throw new Error("cannot retrieve player template");
  }

  /** @type {HTMLTemplateElement | null} */
  const characterTemplate = document.querySelector("#template__character");
  if (!characterTemplate) {
    throw new Error("cannot retrieve character template");
  }
  /* TEMPLATES */

  const containerElement = document.querySelector(".container");
  if (!containerElement) {
    throw new Error("no container element");
  }

  const characterListElement = document.querySelector(".character-list");
  if (!characterListElement) {
    throw new Error("no characterListElement element");
  }

  const url = new URL(window.location.href);
  const authCode = url.searchParams.get("code");
  let /** @type{State|null} */ state;

  if (authCode) {
    if (localStorage.getItem("redeemed_code") === authCode) {
      window.location.href = "/";
      return;
    }

    const keypair = await generateKeypair();

    const response = await fetch(
      `${globalThis.env.thekeeperURL}/auth/redeem/${authCode}`,
      {
        method: "POST",
        headers: {
          Authorization: await auth(keypair.private, keypair.public),
          "Content-Type": "application/x-protobuf",
        },
      },
    );

    if (response.status != 200) {
      const messageElement = document.createElement("h1");

      messageElement.textContent = "Le lien ne marche pas :(";

      containerElement.textContent = "";
      containerElement.appendChild(messageElement);

      return;
    }

    localStorage.clear();

    await storeKeypair(keypair);

    localStorage.setItem("redeemed_code", authCode);

    state = {
      keys: keypair,
      data: newData(),
      cursor: -1,
    };

    await sync(state, true);

    window.location.href = "/";

    return;
  } else {
    state = await getState();
  }

  if (state) {
    Object.keys(state.data.players).forEach((playerId) => {
      const player = state.data.players[playerId];

      const clone = /** @type {HTMLElement} */ (
        playerTemplate.content.cloneNode(true)
      );

      const shareElement = /** @type {HTMLElement} */ (
        clone.querySelector(".player-card__sharelink")
      );

      if (state.data.permission === "orga") {
        shareElement.textContent = "Lien de partage";
        shareElement.setAttribute("data-handle", player.handle);
      }

      const nameElement = /** @type {HTMLElement} */ (
        clone.querySelector(".index__player__head__name")
      );

      const playerTypeLabel = { pj: "PJ", pnj: "PNJ", unknown: "Inscrit" }[
        player.personal?.inscriptionType || "unknown"
      ];
      nameElement.textContent = `${playerTypeLabel} : ${player.personal?.surname || "Sans nom"}`;

      const aElement = /** @type {HTMLElement} */ (clone.querySelector("a"));
      aElement.setAttribute("href", "/informations.html?playerId=" + playerId);

      const charactersElement = /** @type {HTMLElement} */ (
        clone.querySelector(".index__player__characters")
      );

      const createCharacterElement = /** @type {HTMLElement} */ (
        clone.querySelector(".index__player__characters__create")
      );
      createCharacterElement.setAttribute(
        "href",
        "/personnage.html?playerId=" + playerId,
      );

      player.characters.forEach((characterId) => {
        const character = state.data.characters[characterId];
        if (!character) {
          console.warn(
            `Character with ID ${characterId} not found for player ${playerId}`,
          );
          return;
        }
        const characterClone = /** @type {HTMLElement} */ (
          characterTemplate.content.cloneNode(true)
        );
        const characterNameElement = /** @type {HTMLElement} */ (
          characterClone.querySelector(
            ".index__player__characters__character__name",
          )
        );

        const characterPeekElement = /** @type {HTMLElement} */ (
          characterClone.querySelector(
            ".index__player__characters__character__peek",
          )
        );

        const characterLinkElement = /** @type {HTMLElement} */ (
          characterClone.querySelector(
            ".index__player__characters__character__link",
          )
        );
        characterLinkElement.setAttribute(
          "href",
          `/personnage.html?characterId=${characterId}`,
        );

        const characterName = character.name || "Sans nom";
        characterNameElement.textContent = characterName;

        let characterPeek = [];
        characterPeek.push(universMap[character.group]?.label);
        characterPeek.push(universMap[character.race]?.label);
        characterPeek.push(universMap[character.vdv]?.label);

        characterPeek = characterPeek.filter((n) => n);

        characterPeekElement.textContent = characterPeek.join(" - ");

        charactersElement.prepend(characterClone);
      });

      characterListElement?.prepend(clone);
    });

    containerElement
      ?.querySelectorAll(".player-card__sharelink")
      .forEach((span) => {
        span.addEventListener("click", async (e) => {
          e.preventDefault();
          const handle = span.getAttribute("data-handle");
          if (handle) {
            navigator.clipboard.writeText(handle);

            const response = await fetch(
              `${globalThis.env.thekeeperURL}/auth/handles/${handle}`,
              {
                method: "POST",
                headers: {
                  Authorization: await auth(
                    state.keys.private,
                    state.keys.public,
                  ),
                },
              },
            );

            if (response.status != 200) {
              console.error("Error getting sharing link", response);
              return;
            }

            const jsonResponse = await response.json();
            navigator.clipboard.writeText(
              `${globalThis.env.appURL}/index.html?code=${jsonResponse.message}`,
            );
          }
        });
      });
  }

  if (!state || state.data.permission !== "orga") {
    const creationButton = document.createElement("a");
    creationButton.classList.add("character-creation-button");
    creationButton.classList.add("a-underline");
    creationButton.setAttribute("href", "/informations.html");
    creationButton.textContent = "Créer un personnage";
    containerElement?.appendChild(creationButton);
  }
}

async function informations() {
  let state = await getState();

  let /** @type{InformationsForm} */ formResult = {
      surname: "",
      age: "",
      cityOfOrigin: "",
      contact: "",
      approvedConditions: false,
      emergencyContact: "",
      health: "",
      peopleToPlayWith: "",
      skills: "",
      useExistingCharacter: "",
      existingCharacterAchievements: "",
      gameStyle: "",
      gameStyleTags: [],
      situationToAvoid: "",
      inscriptionType: "",
      pictureRights: false,
    };

  const url = new URL(window.location.href);
  const playerId = url.searchParams.get("playerId");

  if (state) {
    if (!playerId && state.data.permission === "orga") {
      window.location.href = "/index.html";
      return;
    }

    if (playerId && state.data.players[playerId].personal) {
      formResult = state.data.players[playerId].personal;
    }
  }

  document.querySelectorAll(".q-select--unique").forEach(function (match) {
    const label = match.querySelector("label");
    const lis = match.querySelectorAll("li");

    const forAttribute = label?.getAttribute("for");
    if (!forAttribute) {
      return;
    }

    if (formResult[forAttribute]) {
      lis.forEach((li) => {
        if (
          formResult[forAttribute].toString() === li.getAttribute("data-key")
        ) {
          li.classList.add("selected");
        }
      });
    }

    attachSelectListeners(lis, forAttribute, false, (op, key, value) => {
      if (op === "select") {
        formResult[key] = value;
      } else {
        delete formResult[key];
      }
    });
  });

  document.querySelectorAll(".q-select--multiple").forEach(function (match) {
    const label = match.querySelector("label");
    const lis = match.querySelectorAll("li");

    const forAttribute = label?.getAttribute("for");
    if (!forAttribute) {
      return;
    }

    if (formResult[forAttribute]) {
      lis.forEach((li) => {
        if (
          formResult[forAttribute].indexOf(li.getAttribute("data-key")) !== -1
        ) {
          li.classList.add("selected");
        }
      });
    }

    attachSelectListeners(lis, forAttribute, true, (op, key, value) => {
      if (op === "select") {
        formResult[key] = (formResult[key] || []).concat([value]);
      } else {
        var index = formResult[key].indexOf(value);
        if (index !== -1) {
          formResult[key].splice(index, 1);
        }
      }
    });
  });

  document.querySelectorAll(".input-text").forEach(function (match) {
    const label = match.querySelector("label");
    const input =
      match.querySelector("input") || match.querySelector("textarea");

    const forAttribute = label?.getAttribute("for");
    if (!forAttribute || !input) {
      return;
    }

    input.value = formResult[forAttribute] || "";

    match.addEventListener("input", (event) => {
      const target = /** @type{HTMLInputElement}*/ (event.target);
      formResult[forAttribute] = target.value;
    });
  });

  document.querySelectorAll(".input-checkbox").forEach(function (match) {
    const label = match.querySelector("label");
    const input = match.querySelector("input");

    const forAttribute = label?.getAttribute("for");
    if (!forAttribute || !input) {
      return;
    }

    input.checked = formResult[forAttribute] || false;

    match.addEventListener("input", (event) => {
      const target = /** @type{HTMLInputElement}*/ (event.target);
      formResult[forAttribute] = target.checked;
    });
  });

  const formElement = document.getElementById("form");

  /**
   * @param {string | null} existingPlayerId
   */
  async function submitForm(existingPlayerId) {
    const events = [];

    if (!state) {
      state = await init();
    }

    let playerId = existingPlayerId;

    if (!existingPlayerId) {
      playerId = createRandomString(8);
      events.push({
        msg: {
          case: "SeedPlayer",
          value: {
            handle: state.data.handle,
            playerId: playerId,
          },
        },
      });
    }

    events.push({
      msg: {
        case: "PlayerPerson",
        value: {
          playerId: playerId,
          surname: formResult.surname,
          age: formResult.age,
          cityOfOrigin: formResult.cityOfOrigin,
          contact: formResult.contact,
          approvedConditions: formResult.approvedConditions,
          emergencyContact: formResult.emergencyContact,
          health: formResult.health,
          peopleToPlayWith: formResult.peopleToPlayWith,
          skills: formResult.skills,
          useExistingCharacter: formResult.useExistingCharacter,
          existingCharacterAchievements:
            formResult.existingCharacterAchievements,
          gameStyle: formResult.gameStyle,
          gameStyleTags: formResult.gameStyleTags,
          situationToAvoid: formResult.situationToAvoid,
          inscriptionType: formResult.inscriptionType,
          pictureRights: formResult.pictureRights,
        },
      },
    });

    let seed = create(EventsSchema, {
      events: events,
    });

    const response = await fetch(`${globalThis.env.thekeeperURL}/state`, {
      method: "POST",
      headers: {
        Authorization: await auth(state.keys.private, state.keys.public),
        "Content-Type": "application/x-protobuf",
      },
      body: toBinary(EventsSchema, seed),
    });

    const jsonResponse = await response.json();
    if (jsonResponse[0].error) {
      throw jsonResponse[0].error;
    }

    if (formResult.inscriptionType === "pj") {
      window.location.href = `/personnage.html?playerId=${playerId}`;
    } else {
      window.location.href = "/";
    }
  }

  if (formElement) {
    formElement.onsubmit = function () {
      submitForm(playerId);

      return false;
    };
  }
}

function watchForHover() {
  // lastTouchTime is used for ignoring emulated mousemove events
  // that are fired after touchstart events. Since they're indistinguishable from real events, we use the fact that they're
  // fired a few milliseconds after touchstart to filter them.
  let lastTouchTime = 0;

  function enableHover() {
    const now = new Date();
    // @ts-ignore
    if (now - lastTouchTime < 500) return;
    document.body.classList.add("hasHover");
  }

  function disableHover() {
    document.body.classList.remove("hasHover");
  }

  function updateLastTouchTime() {
    // @ts-ignore
    lastTouchTime = new Date();
  }

  document.addEventListener("touchstart", updateLastTouchTime, true);
  document.addEventListener("touchstart", disableHover, true);
  document.addEventListener("mousemove", enableHover, true);

  enableHover();
}

watchForHover();

switch (window.location.pathname) {
  case "/personnage.html":
  case "/personnage":
    console.log("route: personnage");

    personnage();
    break;
  case "/informations.html":
  case "/informations":
    console.log("route: informations");

    informations();
    break;
  case "/index.html":
  case "/":
    console.log("route: index");

    index();
    break;
}
