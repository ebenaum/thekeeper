import * as jose from 'jose';
import { create, toJson, toBinary, fromBinary } from "@bufbuild/protobuf";
import { sizeDelimitedDecodeStream } from "@bufbuild/protobuf/wire";
import { EventsSchema } from "./event_pb.js";  

function createRandomString(length) {
    const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
    let result = "";
    const randomArray = new Uint8Array(length);
    crypto.getRandomValues(randomArray);
    randomArray.forEach((number) => {
      result += chars[number % chars.length];
    });
    return result;
  }
  
function buf2hex(buffer) { // buffer is an ArrayBuffer
    return [...new Uint8Array(buffer)]
        .map(x => x.toString(16).padStart(2, '0'))
        .join('');
}

const localStorage = window.localStorage;
let key = JSON.parse(localStorage.getItem("key"));
let handle = localStorage.getItem("handle");

if (!key) {
    const keypair = await jose.generateKeyPair('ES256', { extractable: true, })

    key = {
        public: await window.crypto.subtle.exportKey("jwk", keypair.publicKey),
        private: await window.crypto.subtle.exportKey("jwk", keypair.privateKey),
    }

    localStorage.setItem("key", JSON.stringify(key));
    key = JSON.parse(localStorage.getItem("key"));
}

const privateKey = await window.crypto.subtle.importKey("jwk", key.private, { name: 'ECDSA', namedCurve: 'P-256' }, false, ["sign"]);
const publicKey = await window.crypto.subtle.importKey("jwk", key.public, { name: 'ECDSA', namedCurve: 'P-256' }, true, ["verify"]);


if (!handle) {
    handle = createRandomString(16);

    let seed = create(EventsSchema, {
        events: [{
            msg: {
                case: "SeedActor",
                value: {
                    handle: handle
                }
            }
        }]
    });

    console.log(toJson(EventsSchema, seed));

    await fetch("http://localhost:8081/state", {
        method: "POST",
        headers: {
            "Authorization": await auth(privateKey, publicKey),
            "Content-Type": "application/x-protobuf"
        },
        body: toBinary(EventsSchema, seed),
    })

    localStorage.setItem("handle", handle)
}

async function auth(privateKey, publicKey) {
    return await new jose.SignJWT({})
    .setProtectedHeader({
        alg: 'ES256',
        jwk: await window.crypto.subtle.exportKey("jwk", publicKey),
    })
    .setIssuedAt()
    .setIssuer('self')
    .setAudience('thekeeper')
    .setExpirationTime('5s')
    .sign(privateKey);
}

const response = await fetch("http://localhost:8081/state?from=-1", {
    method: "GET",
    headers: {
        "Authorization": await auth(privateKey, publicKey),
    },
    
})

console.log(fromBinary(EventsSchema, new Uint8Array(await response.arrayBuffer())));

let seed = create(EventsSchema, {
    events: [{
        msg: {
            case: "SeedPlayer",
            value: {
                handle: handle,
                playerId: createRandomString(8),
            }
        }
    }]
});

console.log(toJson(EventsSchema, seed));

await fetch("http://localhost:8081/state", {
    method: "POST",
    headers: {
        "Authorization": await auth(privateKey, publicKey),
        "Content-Type": "application/x-protobuf"
    },
    body: toBinary(EventsSchema, seed),
})

/*

await fetch("http://localhost:8081/state", {
    method: "GET",
    headers: {
        "Authorization": await auth(privateKey, publicKey),
    },
})

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