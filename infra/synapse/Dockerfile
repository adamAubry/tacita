# matrixdotorg/synapse:v1.155.0 (2026-06-16), digest épinglé
FROM matrixdotorg/synapse@sha256:a87d002fba8efba807af19a876f488f4a9d298d6b62f5bab66d14e311a355e99

# gettext-base -> envsubst, pour rendre homeserver.yaml.tmpl avec les secrets du .env
# REQ-INF-08 — synapse-s3-storage-provider non inclus dans l'image officielle
RUN apt-get update \
    && apt-get install -y --no-install-recommends gettext-base \
    && rm -rf /var/lib/apt/lists/* \
    && pip install --no-cache-dir synapse-s3-storage-provider

# D-12 — les modules Synapse sont montés par le compose dans /conf/modules. Sans ce
# chemin dans le PYTHONPATH, `modules:` lève « ModuleNotFoundError » au démarrage et le
# homeserver ne boote pas — un service qui a toutes ses REQ vertes et qui ne démarre pas
# est exactement la règle 4.
ENV PYTHONPATH=/conf/modules

COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

ENTRYPOINT ["/entrypoint.sh"]
CMD ["run"]
