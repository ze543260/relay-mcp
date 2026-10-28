#!/usr/bin/env bash
# Gera o APK e publica nas GitHub Releases; o app instalado se atualiza sozinho.
# Uso: ./publicar.sh 1.1 "notas da versão"
# Precisa da MESMA chave de assinatura (~/.android/debug.keystore desta máquina), senão o Android recusa a atualização.
set -euo pipefail
cd "$(dirname "$0")"
VERSAO=${1:?uso: ./publicar.sh <versao> [notas]}
NOTAS=${2:-"Relay $VERSAO"}
ULTIMO=$(gh release list -R ze543260/relay-mcp --limit 100 --json tagName -q '[.[].tagName|select(startswith("app-"))|ltrimstr("app-")|tonumber]|max // 1')
CODIGO=$((ULTIMO + 1))
JAVA_HOME=${JAVA_HOME:-/opt/android-studio/jbr} ./gradlew -q assembleRelease -Pcodigo="$CODIGO" -Pversao="$VERSAO"
mkdir -p dist && cp app/build/outputs/apk/release/app-release.apk dist/relay.apk
gh release create "app-$CODIGO" dist/relay.apk -R ze543260/relay-mcp -t "Relay $VERSAO ($CODIGO)" -n "$NOTAS"
echo "publicado app-$CODIGO"
