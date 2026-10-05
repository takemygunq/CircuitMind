# Песочница компиляции прошивок. Сборка:  docker build -t circuitmind-compiler docker/compiler
# По умолчанию — ядро AVR (Arduino Uno/Nano) и библиотеки датчиков/дисплеев; другие ядра: --build-arg CORES="arduino:avr rp2040:rp2040"
FROM debian:12-slim

ARG ARDUINO_CLI_VERSION=1.3.1
ARG CORES="arduino:avr"
ARG EXTRA_URLS=""
ARG LIBS="DHT sensor library,Adafruit Unified Sensor,Adafruit GFX Library,Adafruit SSD1306"

RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates curl python3 \
 && rm -rf /var/lib/apt/lists/*

RUN curl -fsSL https://raw.githubusercontent.com/arduino/arduino-cli/master/install.sh | BINDIR=/usr/local/bin sh -s ${ARDUINO_CLI_VERSION}

ENV ARDUINO_DIRECTORIES_DATA=/opt/arduino/data \
    ARDUINO_DIRECTORIES_USER=/opt/arduino/user \
    ARDUINO_DIRECTORIES_DOWNLOADS=/tmp/arduino-downloads \
    ARDUINO_UPDATER_ENABLE_NOTIFICATION=false \
    HOME=/tmp

RUN mkdir -p /opt/arduino/data /opt/arduino/user/libraries /tmp/arduino-downloads \
 && if [ -n "${EXTRA_URLS}" ]; then arduino-cli config init --overwrite && arduino-cli config set board_manager.additional_urls ${EXTRA_URLS}; fi \
 && arduino-cli core update-index \
 && for c in ${CORES}; do arduino-cli core install "$c"; done \
 && IFS=',' && for l in ${LIBS}; do arduino-cli lib install "$l"; done \
 && rm -rf /tmp/arduino-downloads \
 && chmod -R a+rX /opt/arduino

COPY entry.py /usr/local/bin/entry.py

# Непривилегированный пользователь; корневая ФС монтируется read-only, писать можно только в tmpfs /tmp
USER 10001:10001
ENTRYPOINT ["python3", "/usr/local/bin/entry.py"]
