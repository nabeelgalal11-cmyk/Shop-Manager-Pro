FROM postgres:16-alpine

RUN apk add --no-cache curl

COPY run-backup.sh /usr/local/bin/run-backup.sh
RUN chmod 0755 /usr/local/bin/run-backup.sh

ENTRYPOINT ["/usr/local/bin/run-backup.sh"]