// @ts-check

// @ts-ignore
import * as jose from "jose";
// @ts-ignore
import { create, toJson, toBinary, fromBinary } from "@bufbuild/protobuf";
import { EventsSchema } from "./event_pb.js";
import { EventPlayerPersonSchema } from "./player_person_pb.js";

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
 * @param {KeyEntry} keypair
 * @param {string} handle
 * @returns {Promise<State>}
 */
async function init(keypair, handle) {
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

  const response = await fetch("http://localhost:8081/state", {
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

  return state;
}

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
 */

/**
 * @typedef {Object} Data
 * @property {Object.<string, InformationsForm>} players
 * @property {string} handle
 */

/**
 * @typedef {Object} State
 * @property {Data} data
 * @property {number} cursor
 * @property {KeyEntry} keys
 */

/**
 *
 * @returns {Promise<State>}
 */
async function getState() {
  const keys = JSON.parse(/** @type {string} */ (localStorage.getItem("keys")));
  const cursor = Number(/** @type {string} */ (localStorage.getItem("cursor")));

  const data = JSON.parse(/** @type {string} */ (localStorage.getItem("data")));

  if (!keys) {
    const keypair = await generateKeypair();
    storeKeypair(keypair);

    console.log(
      `no keypair, generate new one: ${buf2hex(await window.crypto.subtle.exportKey("raw", keypair.public))}`,
    );

    const state = await init(keypair, createRandomString(16));

    await sync(state, true);

    return state;
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

  const response = await fetch("http://localhost:8081/state?from=" + cursor, {
    method: "GET",
    headers: {
      Authorization: await auth(state.keys.private, state.keys.public),
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

/**
 * @param {Data} data
 * @param {any} eventType
 * @param {any} eventValue
 */
function processEvent(data, eventType, eventValue) {
  switch (eventType) {
    case "SeedPlayer":
      break;
    case "SeedActor":
      data.handle = eventValue.handle;

      break;

    case "PlayerPerson":
      data.players[eventValue.playerId] = toJson(
        EventPlayerPersonSchema,
        eventValue,
      );

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
    .setExpirationTime("5s")
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

async function personnage() {
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
   * @property {string?} img
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
    inventory: {},
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
    formResult.name = /** @type{HTMLInputElement}*/ (e.target)?.value;
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

  let characteristicBudget = parseInt(
    univers
      .find((entry) => entry.key === "characteristics-default-points")
      ?.tags.find((tag) => tag.startsWith("n:"))
      ?.split(":")[1] || "0",
  );

  let skillBudget = parseInt(
    univers
      .find((entry) => entry.key === "skills-default-points")
      ?.tags.find((tag) => tag.startsWith("n:"))
      ?.split(":")[1] || "0",
  );
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
  const characteristicBudgetElement = /** @type {HTMLElement} */ (
    document.querySelector(".characteristics__budget")
  );

  characteristicBudgetElement.textContent = `${characteristicBudget}`;

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
        rank === skill.rankMax
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
    let lvl = 0;

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

    skillResets[skill.key] = () => {
      let cost = 0;
      for (let i = lvl; i > 0; i--) {
        cost += skill.levels[i - 1].cost;
      }

      onSkillPick(skill.key, 0, cost);
      lvl = 0;
      print(node);
    };

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

  inventory.forEach((item) => {
    let numberOfItems = 0;

    const clone = /** @type {HTMLElement} */ (
      inventoryItemTemplate.content.cloneNode(true)
    );

    const titleElement = /** @type {HTMLElement} */ (
      clone.querySelector(".inventory__select__option__content__title")
    );
    const descriptionElement = /** @type {HTMLElement} */ (
      clone.querySelector(".inventory__select__option__content__description")
    );
    const costElement = /** @type {HTMLElement} */ (
      clone.querySelector(".inventory__select__option__picker__cost")
    );

    const numberElement = /** @type {HTMLElement} */ (
      clone.querySelector(".inventory__select__option__picker__control__number")
    );

    titleElement.textContent = item.label;
    descriptionElement.textContent = item.description;

    const cost = parseInt(
      item.tags.find((tag) => tag.startsWith("cost:"))?.split(":")[1] || "0",
    );
    costElement.textContent = cost + (cost === 1 ? " gemme" : " gemmes");

    inventorySelect?.appendChild(clone);
    const node = /** @type {Element} */ (inventorySelect?.lastElementChild);
    const plusElement = /** @type {HTMLElement} */ (
      node.querySelector(".inventory__select__option__picker__control__plus")
    );
    const minusElement = /** @type {HTMLElement} */ (
      node.querySelector(".inventory__select__option__picker__control__minus")
    );

    plusElement?.addEventListener("click", (e) => {
      if (inventoryBudget <= 0) {
        return;
      }
      numberOfItems++;
      numberElement.textContent = numberOfItems + "";

      formResult.inventory[item.key] = numberOfItems;

      inventoryBudget -= cost;
      updateInventoryBudgetState(inventoryBudget);
      updateItemPickerMinusControl(minusElement, numberOfItems);
    });

    minusElement?.addEventListener("click", (e) => {
      if (numberOfItems === 0) {
        return;
      }

      numberOfItems--;
      numberElement.textContent = numberOfItems + "";

      formResult.inventory[item.key] = numberOfItems;
      if (numberOfItems === 0) {
        delete formResult.inventory[item.key];
      }

      inventoryBudget += cost;
      updateInventoryBudgetState(inventoryBudget);
      updateItemPickerMinusControl(minusElement, numberOfItems);
    });
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

    if (budget <= 0) {
      document
        .querySelectorAll(".inventory__select__option__picker__control__plus")
        .forEach((el) => {
          el.classList.add(
            "inventory__select__option__picker__control__plus--disabled",
          );
        });
    } else {
      document
        .querySelectorAll(".inventory__select__option__picker__control__plus")
        .forEach((el) => {
          el.classList.remove(
            "inventory__select__option__picker__control__plus--disabled",
          );
        });
    }
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

  const matches = document.querySelectorAll(".q-select--unique");
  matches.forEach(function (match) {
    const label = match.querySelector("label");
    const lis = match.querySelectorAll("li");

    const forAttribute = label?.getAttribute("for");
    if (forAttribute) {
      attachSelectListeners(lis, forAttribute, false, (op, key, value) => {
        if (op === "select") {
          formResult[key] = value;
        } else {
          delete formResult[key];
        }

        updateSkillList();
      });
    }
  });
}

async function index() {
  /* TEMPLATES */
  /** @type {HTMLTemplateElement | null} */
  const playerTemplate = document.querySelector("#template__player");
  if (!playerTemplate) {
    throw new Error("cannot retrieve player template");
  }

  /* TEMPLATES */

  const containerElement = document.querySelector(".container");

  const url = new URL(window.location.href);
  const authCode = url.searchParams.get("code");
  let /** @type{State} */ state;

  if (authCode) {
    localStorage.clear();

    const keypair = await generateKeypair();

    const response = await fetch(
      `http://localhost:8081/auth/redeem/${authCode}`,
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

      containerElement?.appendChild(messageElement);

      return;
    }

    await storeKeypair(keypair);

    state = {
      keys: keypair,
      data: newData(),
      cursor: -1,
    };

    await sync(state, true);
  } else {
    state = await getState();

    Object.keys(state.data.players).forEach((playerId) => {
      const player = state.data.players[playerId];

      const clone = /** @type {HTMLElement} */ (
        playerTemplate.content.cloneNode(true)
      );

      const aElement = /** @type {HTMLElement} */ (clone.querySelector("a"));
      aElement.textContent = player.surname;
      aElement.setAttribute("href", "/informations.html?playerId=" + playerId);

      containerElement?.prepend(clone);
    });
  }
}

async function informations() {
  const state = await getState();

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
    };

  const url = new URL(window.location.href);
  const playerId = url.searchParams.get("playerId");
  if (playerId) {
    formResult = state.data.players[playerId];
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
   *
   * @param {string | null} existingPlayerId
   */
  async function submitForm(existingPlayerId) {
    const events = [];

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
        },
      },
    });

    let seed = create(EventsSchema, {
      events: events,
    });

    const response = await fetch("http://localhost:8081/state", {
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

    if (!existingPlayerId) {
      window.location.href = `?playerId=${playerId}`;
    }
  }

  if (formElement) {
    formElement.onsubmit = function () {
      submitForm(playerId);

      return false;
    };
  }
}

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
