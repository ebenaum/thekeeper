import * as jose from 'jose';

function buf2hex(buffer) { // buffer is an ArrayBuffer
    return [...new Uint8Array(buffer)]
        .map(x => x.toString(16).padStart(2, '0'))
        .join('');
}

const localStorage = window.localStorage;
let key = JSON.parse(localStorage.getItem("key"));

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

const jwt = await new jose.SignJWT({ 'urn:example:claim': true })
    .setProtectedHeader({
        alg: 'ES256',
        jwk: await window.crypto.subtle.exportKey("jwk", publicKey),
    })
    .setIssuedAt()
    .setIssuer('urn:example:issuer')
    .setAudience('urn:example:audience')
    .setExpirationTime('2h')
    .sign(privateKey);

await fetch("http://localhost:8081/state", {
    method: "GET",
    headers: {
        "Authorization": jwt,
    },
})

const form = document.getElementById("form");

form.addEventListener("submit", async function (event) {
    event.preventDefault();
    const formData = Object.fromEntries(new FormData(form));
    const events = [];

    events.push(
        { key: "seed", data: { index: 1 } },
        { key: "set-name", data: { ...formData, index: 1 } },
    )

    await fetch("http://localhost:8081/state", {
        method: "POST",
        headers: {
            "Authorization": jwt,
        },
        body: JSON.stringify(events),
    })
});