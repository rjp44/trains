#!/bin/sh
# Create local release credentials once. Only public certificates go into builds.
set -eu
ip=${1:?Usage: identity.sh LAN_IPV4 PRIVATE_DIRECTORY}
dir=${2:?Missing private directory}
umask 077
mkdir -p "$dir"
chmod 700 "$dir"
cd "$dir"
test -f signing.key || openssl ecparam -name prime256v1 -genkey -noout -out signing.key
openssl ec -in signing.key -pubout -out signing.pem 2>/dev/null
test -f ca.key || openssl req -new -newkey rsa:3072 -nodes -x509 -sha256 -days 3650 -subj '/CN=Transport Display Local Release CA' -keyout ca.key -out ca.pem -extensions ca_ext -config /dev/stdin <<'CFG'
[req]
distinguished_name=dn
[dn]
[ca_ext]
basicConstraints=critical,CA:true
keyUsage=critical,keyCertSign,cRLSign
CFG
openssl req -new -newkey rsa:2048 -nodes -subj "/CN=$ip" -keyout server.key -out server.csr
printf 'basicConstraints=critical,CA:false\nkeyUsage=critical,digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\nsubjectAltName=IP:%s,DNS:localhost,IP:127.0.0.1\n' "$ip" > server.ext
openssl x509 -req -in server.csr -CA ca.pem -CAkey ca.key -CAcreateserial -days 365 -sha256 -extfile server.ext -out server.pem
