const { test, before } = require("node:test");
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");

const BASE = process.env.BASE_URL || "https://localhost:8443";
const PASSWORD = "phrase-de-passe-de-test";

let cookie;

function form(fields) {
  return new URLSearchParams(fields);
}

async function request(path, options = {}) {
  return fetch(`${BASE}${path}`, {
    redirect: "manual",
    ...options,
    headers: { ...(cookie && { Cookie: cookie }), ...options.headers },
  });
}

before(async () => {
  const email = `test-${randomUUID()}@test.local`;
  await request("/register", { method: "POST", body: form({ email, password: PASSWORD, confirmation: PASSWORD }) });

  const login = await request("/login", { method: "POST", body: form({ email, password: PASSWORD }) });
  assert.equal(login.status, 303, "la connexion du compte de test doit réussir");
  cookie = login.headers.get("set-cookie").split(";")[0];
});

test("injection SQL : ' OR '1'='1 dans la recherche ne renvoie aucune note", async () => {
  const title = `note-temoin-${randomUUID()}`;
  await request("/notes", { method: "POST", body: form({ title, body: "contenu" }) });

  const all = await request("/");
  assert.match(await all.text(), new RegExp(title), "la note témoin existe bien");

  const attack = await request(`/?q=${encodeURIComponent("' OR '1'='1")}`);
  const html = await attack.text();

  assert.equal(attack.status, 200);
  assert.match(html, /0 résultat\(s\)/);
  assert.doesNotMatch(html, new RegExp(title));
});

test("XSS : <img src=x onerror=alert(1)> ressort échappé", async () => {
  const payload = "<img src=x onerror=alert(1)>";
  await request("/notes", { method: "POST", body: form({ title: payload, body: "<script>alert(2)</script>" }) });

  const response = await request("/");
  const html = await response.text();

  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.match(html, /&lt;script&gt;alert\(2\)&lt;\/script&gt;/);
  assert.ok(!html.includes(payload), "la balise brute ne doit jamais apparaître");
  assert.ok(!html.includes("<script>alert(2)</script>"), "le script brut ne doit jamais apparaître");
  assert.match(response.headers.get("content-security-policy"), /script-src 'none'/);
});

test("upload : un .php et un .svg sont refusés", async () => {
  const forbidden = [
    { name: "shell.php", content: '<?php system($_GET["c"]); ?>', type: "application/x-php" },
    { name: "image.svg", content: '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>', type: "image/svg+xml" },
    { name: "deguise.png", content: '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>', type: "image/png" },
  ];

  for (const file of forbidden) {
    const body = new FormData();
    body.append("file", new Blob([file.content], { type: file.type }), file.name);

    const response = await request("/files", { method: "POST", body });
    const html = await response.text();

    assert.equal(response.status, 415, `${file.name} doit être refusé`);
    assert.match(html, /Type de fichier refusé/);
    assert.ok(!html.includes(file.name), `${file.name} ne doit pas apparaître dans la liste`);
  }
});
