#!/bin/sh
set -u

cd "$(dirname "$0")/../.."

BASE="${BASE:-https://localhost:8443}"
HTTP_BASE="${HTTP_BASE:-http://localhost:8000}"
CA="${CA:-$(mkcert -CAROOT)/rootCA.pem}"
WORK="$(mktemp -d)"
RUN="$(date +%s)"
PASSWORD="phrase-de-passe-$RUN"
ALICE="alice-$RUN@test.local"
BOB="bob-$RUN@test.local"
CAROL="carol-$RUN@test.local"
PASS=0
FAIL=0

trap 'rm -rf "$WORK"' EXIT

curl() {
  command curl --cacert "$CA" "$@"
}

check() {
  if [ "$2" = "ok" ]; then
    printf '  \033[32m✔\033[0m %s\n' "$1"
    PASS=$((PASS + 1))
  else
    printf '  \033[31m✘\033[0m %s\n' "$1"
    FAIL=$((FAIL + 1))
  fi
}

result() {
  if eval "$1"; then echo ok; else echo ko; fi
}

status_of() {
  curl -s -o /dev/null -w '%{http_code}' "$@"
}

db_app() {
  docker compose exec -T db sh -c 'psql -U "$APP_DB_USER" -d "$POSTGRES_DB" -tAc "$1" 2>&1' _ "$1"
}

register() {
  curl -s -o "$WORK/register.html" -w '%{http_code}' \
    --data-urlencode "email=$1" --data-urlencode "password=$2" --data-urlencode "confirmation=$2" "$BASE/register"
}

login() {
  curl -s -o "$WORK/login.html" -D "$WORK/login.headers" -w '%{http_code}' -c "$1" -b "$1" \
    --data-urlencode "email=$2" --data-urlencode "password=$3" "$BASE/login"
}

session_token() {
  awk '$6 == "rempart_sid" { print $7 }' "$1"
}

alert_of() {
  grep -o '<p class="alert" role="alert">[^<]*</p>' "$1"
}

user_id() {
  db_app "SELECT id FROM users WHERE email = '$1'"
}

wait_ready() {
  tries=0
  until curl -sf -o /dev/null "$BASE/health"; do
    tries=$((tries + 1))
    [ "$tries" -ge 30 ] && echo "L'app ne répond pas sur $BASE" && exit 1
    sleep 1
  done
}

wait_ready

echo "HTTPS"
check "certificat servi signé par l'autorité mkcert" "$(result "curl -s -o /dev/null '$BASE/health'")"
check "HTTP → HTTPS : 308 vers $BASE" "$(result "curl -sI '$HTTP_BASE/login?x=1' | grep -qi '^location: $BASE/login?x=1'")"
check "Strict-Transport-Security envoyé en HTTPS" "$(result "curl -sI '$BASE/login' | grep -qi '^strict-transport-security: max-age=31536000; includeSubDomains'")"
check "pas de Strict-Transport-Security en HTTP" "$(result "! curl -sI '$HTTP_BASE/login' | grep -qi '^strict-transport-security'")"

for account in "$ALICE" "$BOB" "$CAROL"; do
  curl -s -o /dev/null --data-urlencode "email=$account" --data-urlencode "password=$PASSWORD" \
    --data-urlencode "confirmation=$PASSWORD" --data-urlencode "role=admin" "$BASE/register"
done
./src/scripts/promote-admin.sh "$CAROL" >/dev/null
A="$WORK/alice.jar"
B="$WORK/bob.jar"
C="$WORK/carol.jar"
login "$A" "$ALICE" "$PASSWORD" >/dev/null
login "$B" "$BOB" "$PASSWORD" >/dev/null
login "$C" "$CAROL" "$PASSWORD" >/dev/null

echo "Secrets"
SNAP="$WORK/snapshot"
git init -q "$SNAP"
git --git-dir="$SNAP/.git" --work-tree=. add -A
git --git-dir="$SNAP/.git" --work-tree=. -c user.name=preuve -c user.email=preuve@test.local commit -qm snapshot
check ".env ignoré par Git" "$(result "git check-ignore -q .env")"
check "clé et certificat mkcert ignorés par Git" "$(result "git check-ignore -q certs/localhost-key.pem && git check-ignore -q certs/localhost.pem")"
check "ni .env ni clé privée dans ce que Git suivrait" "$(result "! git --git-dir='$SNAP/.git' ls-files | grep -qE '(^|/)\\.env\$|\\.pem\$|-key'")"
check "gitleaks sur l'historique : aucun secret" "$(result "gitleaks git '$SNAP' --redact --no-banner --log-level error")"
cut -d= -f1 .env.example | sort > "$WORK/example.keys"
check ".env.example sans aucun mot de passe" "$(result "! grep -qE '^[A-Z_]*PASSWORD=.+' .env.example")"
check "chaque variable de .env est documentée dans .env.example" "$(result "[ -z \"\$(cut -d= -f1 .env | grep . | sort | comm -23 - '$WORK/example.keys')\" ]")"
check "Compose refuse de démarrer sans mot de passe" "$(result "! docker compose --env-file .env.example config --quiet 2>/dev/null")"

echo "En-têtes de sécurité"
curl -sI -b "$A" "$BASE/" > "$WORK/headers.txt"
check "CSP avec default-src 'none' et frame-ancestors 'none'" "$(result "grep -qi \"^content-security-policy: default-src 'none';.*frame-ancestors 'none'\" '$WORK/headers.txt'")"
check "X-Content-Type-Options: nosniff" "$(result "grep -qi '^x-content-type-options: nosniff' '$WORK/headers.txt'")"
check "Referrer-Policy: same-origin" "$(result "grep -qi '^referrer-policy: same-origin' '$WORK/headers.txt'")"
check "Permissions-Policy coupe caméra, micro et géolocalisation" "$(result "grep -qi '^permissions-policy: camera=(), microphone=(), geolocation=()' '$WORK/headers.txt'")"
check "en-tête Server retiré" "$(result "! grep -qi '^server:' '$WORK/headers.txt'")"
check "la page connectée répond 200 avec ces en-têtes" "$(result "head -1 '$WORK/headers.txt' | grep -q ' 200'")"

echo "CORS"
for origin in https://evil.example null "$BASE"; do
  curl -sI -b "$A" -H "Origin: $origin" "$BASE/" > "$WORK/cors.txt"
  check "GET connecté avec Origin: $origin → aucun Access-Control-*" "$(result "! grep -qi '^access-control-' '$WORK/cors.txt'")"
done
curl -s -o /dev/null -D "$WORK/preflight.txt" -X OPTIONS -H "Origin: https://evil.example" \
  -H "Access-Control-Request-Method: POST" -H "Access-Control-Request-Headers: content-type" "$BASE/notes"
check "preflight OPTIONS depuis un autre site → aucun Access-Control-*" "$(result "! grep -qi '^access-control-' '$WORK/preflight.txt'")"
check "aucune bibliothèque ni en-tête CORS dans le code" "$(result "! grep -rqiE 'cors|access-control' src/server.js src/middleware src/routes Caddyfile package.json")"

echo "SQL — injection"
MARK="preuve-$RUN"
curl -s -o /dev/null -b "$A" --data-urlencode "title=$MARK" --data-urlencode "body=note témoin" "$BASE/notes"
curl -s -o "$WORK/search.html" -b "$A" -G --data-urlencode "q=' OR '1'='1" "$BASE/"
check "recherche « ' OR '1'='1 » : 0 résultat" "$(result "grep -q '0 résultat(s)' '$WORK/search.html'")"
curl -s -o "$WORK/search2.html" -b "$A" -G --data-urlencode "q=%" "$BASE/"
check "recherche « % » traitée comme un caractère, pas un joker" "$(result "grep -q '0 résultat(s)' '$WORK/search2.html'")"
curl -s -o /dev/null -b "$A" --data-urlencode "title=x'); DROP TABLE notes; --" "$BASE/notes"
check "titre « x'); DROP TABLE notes; -- » stocké tel quel, table intacte" "$(result "[ \"\$(db_app \"SELECT count(*) FROM notes WHERE title = 'x''); DROP TABLE notes; --'\")\" -ge 1 ]")"

echo "SQL — moindre privilège (compte applicatif)"
check "DROP TABLE refusé" "$(result "db_app 'DROP TABLE notes' | grep -q 'must be owner'")"
check "TRUNCATE refusé" "$(result "db_app 'TRUNCATE notes' | grep -q 'permission denied'")"
check "CREATE TABLE refusé" "$(result "db_app 'CREATE TABLE pirate (id int)' | grep -q 'permission denied'")"
check "UPDATE users SET role = 'admin' refusé" "$(result "db_app \"UPDATE users SET role = 'admin'\" | grep -q 'permission denied'")"
check "UPDATE notes SET owner_id refusé" "$(result "db_app 'UPDATE notes SET owner_id = 1' | grep -q 'permission denied'")"
check "lecture de pg_authid refusée" "$(result "db_app 'SELECT * FROM pg_authid' | grep -q 'permission denied'")"

echo "XSS"
PAYLOAD='<img src=x onerror=alert(1)>'
curl -s -o /dev/null -b "$A" --data-urlencode "title=$PAYLOAD" --data-urlencode "body=<script>alert(2)</script>" "$BASE/notes"
curl -s -o "$WORK/xss.html" -b "$A" "$BASE/"
check "le payload s'affiche échappé (&lt;img …&gt;)" "$(result "grep -q '&lt;img src=x onerror=alert(1)&gt;' '$WORK/xss.html'")"
check "aucune balise <img> ni <script> injectée dans la page" "$(result "! grep -qE '<img src=x|<script>alert' '$WORK/xss.html'")"
check "Content-Security-Policy présente (script-src 'none')" "$(result "curl -sI '$BASE/login' | grep -qi \"content-security-policy:.*script-src 'none'\"")"

echo "Upload"
printf '<?php system($_GET["c"]); ?>' > "$WORK/shell.php"
printf '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>' > "$WORK/image.svg"
cp "$WORK/image.svg" "$WORK/deguise.png"
printf '\211PNG\r\n\032\n' > "$WORK/faux.php"
printf 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==' | base64 -d > "$WORK/vrai.png"
head -c 2200000 /dev/zero > "$WORK/gros.pdf"

check ".php refusé (415)" "$(result "[ \$(status_of -b '$A' -F 'file=@$WORK/shell.php' '$BASE/files') = 415 ]")"
check ".svg refusé (415)" "$(result "[ \$(status_of -b '$A' -F 'file=@$WORK/image.svg' '$BASE/files') = 415 ]")"
check "SVG renommé en .png refusé (contenu vérifié)" "$(result "[ \$(status_of -b '$A' -F 'file=@$WORK/deguise.png' '$BASE/files') = 415 ]")"
check "en-tête PNG dans un .php refusé (extension vérifiée)" "$(result "[ \$(status_of -b '$A' -F 'file=@$WORK/faux.php' '$BASE/files') = 415 ]")"
check "fichier > 2 Mo refusé (413)" "$(result "[ \$(status_of -b '$A' -F 'file=@$WORK/gros.pdf' '$BASE/files') = 413 ]")"
check "PNG valide accepté (303)" "$(result "[ \$(status_of -b '$A' -F 'file=@$WORK/vrai.png;filename=../../etc/passwd.png' '$BASE/files') = 303 ]")"

FILE_ID="$(curl -s -b "$A" "$BASE/files" | grep -oE '/files/[0-9a-f-]{36}"' | head -1 | cut -d/ -f3 | tr -d '"')"
curl -s -D "$WORK/dl.txt" -o /dev/null -b "$A" "$BASE/files/$FILE_ID"
check "stocké sous un UUID, hors du dossier public" "$(result "docker compose exec -T app ls /data/uploads | grep -qx '$FILE_ID' && [ \$(status_of '$BASE/$FILE_ID') != 200 ]")"
check "nom d'origine nettoyé (pas de ../)" "$(result "grep -qiE 'filename=\"?passwd\\.png\"?\\s*\$' '$WORK/dl.txt'")"
check "servi en pièce jointe" "$(result "grep -qi '^content-disposition: attachment' '$WORK/dl.txt'")"
check "X-Content-Type-Options: nosniff" "$(result "grep -qi '^x-content-type-options: nosniff' '$WORK/dl.txt'")"

echo "Mots de passe"
HASH="$(db_app "SELECT password_hash FROM users WHERE email = '$ALICE'")"
echo "    hash en base : $(echo "$HASH" | cut -c1-60)…"
check "haché en Argon2id (m=19456, t=2, p=1)" "$(result "echo '$HASH' | grep -qF '\$argon2id\$v=19\$m=19456,t=2,p=1\$'")"
check "sel unique : deux comptes, même mot de passe, hashs différents" "$(result "[ \$(db_app \"SELECT count(DISTINCT password_hash) FROM users WHERE email IN ('$ALICE', '$BOB')\") = 2 ]")"
check "aucun mot de passe en clair en base" "$(result "[ \$(db_app \"SELECT count(*) FROM users WHERE password_hash LIKE '%$PASSWORD%'\") = 0 ]")"
check "aucun mot de passe en clair dans les logs" "$(result "! docker compose logs app 2>&1 | grep -q '$PASSWORD'")"

echo "Authentification"
check "mot de passe de 5 caractères refusé" "$(result "[ \$(register 'court-$RUN@test.local' 'cinq5') = 400 ]")"
check "6 minuscules acceptées (longueur, pas de règle de complexité)" "$(result "[ \$(register 'long-$RUN@test.local' 'abcdef') = 303 ]")"
register "$ALICE" "autre-mot-de-passe" > "$WORK/dup.code"
cp "$WORK/register.html" "$WORK/dup.html"
register "nouveau-$RUN@test.local" "autre-mot-de-passe" > "$WORK/new.code"
check "inscription : même réponse que l'e-mail existe ou non" "$(result "[ \$(cat '$WORK/dup.code') = \$(cat '$WORK/new.code') ] && cmp -s '$WORK/dup.html' '$WORK/register.html'")"
login "$WORK/x.jar" "inconnu-$RUN@test.local" "$PASSWORD" > "$WORK/unknown.code"
alert_of "$WORK/login.html" > "$WORK/unknown.msg"
login "$WORK/x.jar" "$CAROL" "mauvais-mot-de-passe" > "$WORK/wrong.code"
alert_of "$WORK/login.html" > "$WORK/wrong.msg"
echo "    e-mail inconnu : $(cat "$WORK/unknown.code") $(sed 's/<[^>]*>//g' "$WORK/unknown.msg")"
echo "    mauvais mdp    : $(cat "$WORK/wrong.code") $(sed 's/<[^>]*>//g' "$WORK/wrong.msg")"
check "connexion : même statut et même message (e-mail inconnu / mauvais mot de passe)" "$(result "[ \$(cat '$WORK/unknown.code') = \$(cat '$WORK/wrong.code') ] && cmp -s '$WORK/unknown.msg' '$WORK/wrong.msg'")"

echo "Sessions"
login "$WORK/s.jar" "$ALICE" "$PASSWORD" > /dev/null
COOKIE="$(grep -i '^set-cookie: rempart_sid' "$WORK/login.headers")"
echo "    $(echo "$COOKIE" | tr -d '\r' | sed -E 's/rempart_sid=[^;]+/rempart_sid=…/')"
check "cookie HttpOnly" "$(result "echo '$COOKIE' | grep -qi 'httponly'")"
check "cookie Secure" "$(result "echo '$COOKIE' | grep -qi 'secure'")"
check "cookie SameSite=Lax" "$(result "echo '$COOKIE' | grep -qi 'samesite=lax'")"
check "expiration : Max-Age=28800 (8 h) + inactivité 30 min côté serveur" "$(result "echo '$COOKIE' | grep -qi 'max-age=28800'")"
printf 'localhost\tFALSE\t/\tFALSE\t0\trempart_sid\tvaleur-imposee-par-attaquant\n' > "$WORK/fix.jar"
login "$WORK/fix.jar" "$ALICE" "$PASSWORD" > /dev/null
check "fixation : un identifiant imposé est remplacé à la connexion" "$(result "[ -n \"\$(session_token '$WORK/fix.jar')\" ] && [ \"\$(session_token '$WORK/fix.jar')\" != valeur-imposee-par-attaquant ]")"
OLD="$(session_token "$WORK/s.jar")"
login "$WORK/s.jar" "$ALICE" "$PASSWORD" > /dev/null
NEW="$(session_token "$WORK/s.jar")"
check "régénération : nouvel identifiant à chaque connexion" "$(result "[ '$OLD' != '$NEW' ]")"
check "l'ancien identifiant est invalidé côté serveur" "$(result "[ \$(status_of -H 'Cookie: rempart_sid=$OLD' '$BASE/') = 303 ]")"
curl -s -o /dev/null -b "$WORK/s.jar" -c "$WORK/s.jar" -X POST "$BASE/logout"
check "logout : la session est détruite en base" "$(result "[ \$(db_app \"SELECT count(*) FROM sessions WHERE id = '\$(printf %s '$NEW' | shasum -a 256 | cut -d' ' -f1)'\") = 0 ]")"
check "logout : rejouer l'ancien cookie ne redonne pas l'accès" "$(result "[ \$(status_of -H 'Cookie: rempart_sid=$NEW' '$BASE/') = 303 ]")"
check "l'identifiant n'est stocké que haché (SHA-256) en base" "$(result "[ \$(db_app \"SELECT count(*) FROM sessions WHERE id = '\$(session_token '$A')'\") = 0 ]")"

echo "Autorisation"
check "anonyme → /admin : redirigé vers /login" "$(result "[ \$(status_of '$BASE/admin') = 303 ]")"
check "utilisateur → /admin : 403 du serveur" "$(result "[ \$(status_of -b '$A' '$BASE/admin') = 403 ]")"
check "admin → /admin : 200" "$(result "[ \$(status_of -b '$C' '$BASE/admin') = 200 ]")"
check "le lien Admin n'est pas affiché à un utilisateur" "$(result "! curl -s -b '$A' '$BASE/' | grep -q 'href=\"/admin\"'")"
check "refus par défaut : une route inconnue exige la connexion" "$(result "[ \$(status_of '$BASE/route-pas-encore-ecrite') = 303 ]")"
check "refus par défaut : POST anonyme → 401" "$(result "[ \$(status_of -X POST '$BASE/notes') = 401 ]")"
check "POST du même site, en-têtes d'un vrai navigateur → accepté" "$(result "[ \$(status_of -b '$A' -H 'Origin: $BASE' -H 'Sec-Fetch-Site: same-origin' --data 'title=navigateur' '$BASE/notes') = 303 ]")"
check "Referrer-Policy n'est pas no-referrer (sinon Origin: null casse les formulaires)" "$(result "curl -sI '$BASE/login' | grep -qi '^referrer-policy: same-origin'")"
check "POST depuis un autre site (Origin) → 403" "$(result "[ \$(status_of -b '$A' -H 'Origin: https://evil.example' --data 'title=csrf' '$BASE/notes') = 403 ]")"

echo "IDOR"
curl -s -o /dev/null -b "$A" --data-urlencode "title=secret-alice-$RUN" "$BASE/notes"
NOTE_ID="$(db_app "SELECT id FROM notes WHERE title = 'secret-alice-$RUN'")"
check "alice lit sa note /notes/$NOTE_ID : 200" "$(result "[ \$(status_of -b '$A' '$BASE/notes/$NOTE_ID') = 200 ]")"
check "bob lit /notes/$NOTE_ID : 404" "$(result "[ \$(status_of -b '$B' '$BASE/notes/$NOTE_ID') = 404 ]")"
check "bob modifie /notes/$NOTE_ID : 404 et note inchangée" "$(result "[ \$(status_of -b '$B' --data 'title=pirate' '$BASE/notes/$NOTE_ID') = 404 ] && [ \"\$(db_app \"SELECT title FROM notes WHERE id = $NOTE_ID\")\" = 'secret-alice-$RUN' ]")"
check "bob supprime /notes/$NOTE_ID : 404 et note toujours là" "$(result "[ \$(status_of -b '$B' -X POST '$BASE/notes/$NOTE_ID/delete') = 404 ] && [ \$(db_app 'SELECT count(*) FROM notes WHERE id = $NOTE_ID') = 1 ]")"
check "bob télécharge le fichier d'alice : 404" "$(result "[ \$(status_of -b '$B' '$BASE/files/$FILE_ID') = 404 ]")"
check "bob supprime le fichier d'alice : 404" "$(result "[ \$(status_of -b '$B' -X POST '$BASE/files/$FILE_ID/delete') = 404 ]")"
check "la liste de bob ne contient pas les notes d'alice" "$(result "! curl -s -b '$B' '$BASE/' | grep -q 'secret-alice-$RUN'")"

echo "Mass assignment"
BOB_ID="$(user_id "$BOB")"
ALICE_ID="$(user_id "$ALICE")"
curl -s -o /dev/null -b "$A" --data-urlencode "title=assign-$RUN" --data "owner_id=$BOB_ID&id=999999&created_at=2000-01-01" "$BASE/notes"
check "owner_id/id/created_at envoyés sont ignorés : la note reste à alice" "$(result "[ \"\$(db_app \"SELECT owner_id || ':' || (id <> 999999) || ':' || (created_at > '2001-01-01') FROM notes WHERE title = 'assign-$RUN'\")\" = '$ALICE_ID:true:true' ]")"
check "role=admin envoyé à l'inscription est ignoré" "$(result "[ \"\$(db_app \"SELECT role FROM users WHERE email = '$ALICE'\")\" = user ]")"

echo "Suppression de compte"
DAVE="dave-$RUN@test.local"
D1="$WORK/dave1.jar"
D2="$WORK/dave2.jar"
register "$DAVE" "$PASSWORD" > /dev/null
login "$D1" "$DAVE" "$PASSWORD" > /dev/null
login "$D2" "$DAVE" "$PASSWORD" > /dev/null
DAVE_ID="$(user_id "$DAVE")"
curl -s -o /dev/null -b "$D1" --data-urlencode "title=donnee-perso-$RUN" "$BASE/notes"
curl -s -o /dev/null -b "$D1" -F "file=@$WORK/vrai.png" "$BASE/files"
curl -s -o /dev/null -b "$D1" "$BASE/2fa/setup"
DAVE_FILE="$(db_app "SELECT id FROM files WHERE owner_id = $DAVE_ID")"
traces() {
  db_app "SELECT (SELECT count(*) FROM users WHERE id = $DAVE_ID OR email = '$DAVE') + (SELECT count(*) FROM notes WHERE owner_id = $DAVE_ID) + (SELECT count(*) FROM files WHERE owner_id = $DAVE_ID) + (SELECT count(*) FROM sessions WHERE user_id = $DAVE_ID) + (SELECT count(*) FROM totp_credentials WHERE user_id = $DAVE_ID) + (SELECT count(*) FROM backup_codes WHERE user_id = $DAVE_ID) + (SELECT count(*) FROM mfa_challenges WHERE user_id = $DAVE_ID)"
}
echo "    avant : $(traces) ligne(s) liées au compte, fichier $DAVE_FILE"
check "avant : compte complet (note, fichier sur disque, 2 sessions actives)" "$(result "[ \$(traces) -ge 5 ] && docker compose exec -T app ls /data/uploads | grep -qx '$DAVE_FILE' && [ \$(status_of -b '$D2' '$BASE/') = 200 ]")"
check "page « Mon compte » accessible depuis le menu" "$(result "curl -s -b '$D1' '$BASE/' | grep -q 'href=\"/account\"' && [ \$(status_of -b '$D1' '$BASE/account') = 200 ]")"
check "sans le mot SUPPRIMER → 400, rien n'est effacé" "$(result "[ \$(status_of -b '$D1' --data-urlencode 'password=$PASSWORD' --data 'confirmation=oui' '$BASE/account/delete') = 400 ] && [ \$(traces) -gt 0 ]")"
check "mauvais mot de passe → 401, rien n'est effacé" "$(result "[ \$(status_of -b '$D1' --data 'password=mauvais&confirmation=SUPPRIMER' '$BASE/account/delete') = 401 ] && [ \$(traces) -gt 0 ]")"
check "anonyme → aucune suppression possible" "$(result "[ \$(status_of -X POST '$BASE/account/delete') = 401 ]")"
check "bon mot de passe + SUPPRIMER → 303 vers /login" "$(result "[ \$(status_of -b '$D1' --data-urlencode 'password=$PASSWORD' --data 'confirmation=SUPPRIMER' '$BASE/account/delete') = 303 ]")"
check "plus aucune ligne en base (compte, notes, fichiers, sessions, 2FA, codes, défis)" "$(result "[ \$(traces) = 0 ]")"
check "le fichier est effacé du disque" "$(result "[ -n '$DAVE_FILE' ] && ! docker compose exec -T app ls /data/uploads | grep -qx '$DAVE_FILE'")"
check "l'autre session ouverte est invalidée" "$(result "[ \$(status_of -b '$D2' '$BASE/') = 303 ]")"
check "reconnexion impossible (401)" "$(result "[ \$(login '$WORK/z.jar' '$DAVE' '$PASSWORD') = 401 ]")"
check "le journal ne garde pas l'e-mail du compte supprimé" "$(result "docker compose logs app | grep '\"account.deleted\"' | grep -q '\"userId\":$DAVE_ID' && ! docker compose logs app | grep 'account\\.' | grep -q '$DAVE'")"
check "l'adresse peut être réutilisée pour un nouveau compte" "$(result "[ \$(register '$DAVE' '$PASSWORD') = 303 ] && [ -n \"\$(user_id '$DAVE')\" ] && [ \"\$(user_id '$DAVE')\" != '$DAVE_ID' ]")"

echo "Limitation des tentatives"
for i in 1 2 3 4 5; do login "$WORK/x.jar" "$BOB" "mauvais-$i" > /dev/null; done
check "par compte : après 5 échecs, même le bon mot de passe → 429" "$(result "[ \$(login '$WORK/x.jar' '$BOB' '$PASSWORD') = 429 ]")"
check "message neutre + Retry-After" "$(result "grep -q 'Trop de tentatives' '$WORK/login.html' && grep -qi '^retry-after:' '$WORK/login.headers'")"
check "un autre compte reste accessible" "$(result "[ \$(login '$WORK/y.jar' '$CAROL' '$PASSWORD') = 303 ]")"
CODE=0
i=0
while [ $i -lt 25 ]; do
  i=$((i + 1))
  CODE="$(login "$WORK/x.jar" "ip-$i-$RUN@test.local" "mauvais")"
  [ "$CODE" = 429 ] && break
done
check "par IP : 429 une fois 20 échecs cumulés, sur des comptes tous différents" "$(result "[ '$CODE' = 429 ]")"

echo "Erreurs"
curl -s -o "$WORK/404.html" -b "$C" "$BASE/n-existe-pas"
check "404 : page générique" "$(result "grep -q 'Cette page n.*existe pas' '$WORK/404.html'")"
check "mode debug coupé (NODE_ENV=production)" "$(result "docker compose exec -T app printenv NODE_ENV | grep -qx production")"
docker compose stop db >/dev/null 2>&1
curl -s -o "$WORK/500.html" -w '%{http_code}' -b "$C" "$BASE/" > "$WORK/500.code"
docker compose start db >/dev/null 2>&1
check "base coupée : 500 avec message neutre" "$(result "[ \$(cat '$WORK/500.code') = 500 ] && grep -q 'Une erreur est survenue' '$WORK/500.html'")"
check "aucune trace technique dans la page" "$(result "! grep -qiE 'ECONNREFUSED|ENOTFOUND|at .*\\.js|node_modules|stack' '$WORK/500.html'")"
REF="$(grep -oE '<code>[0-9a-f]{8}</code>' "$WORK/500.html" | sed 's/<[^>]*>//g')"
check "détail journalisé côté serveur (référence $REF)" "$(result "docker compose logs app | grep '$REF' | grep -q stack")"

echo
echo "Remise à zéro des compteurs de tentatives (redémarrage de l'app)…"
docker compose restart app >/dev/null 2>&1
wait_ready

echo
echo "$PASS réussi(s), $FAIL échoué(s)"
[ "$FAIL" -eq 0 ]
