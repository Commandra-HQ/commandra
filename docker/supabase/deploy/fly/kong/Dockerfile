FROM kong/kong:3.9.1
COPY kong.fly.yml /home/kong/temp.yml
COPY --chmod=755 kong-entrypoint.sh /tmp/kong-entrypoint.sh
ENTRYPOINT ["/tmp/kong-entrypoint.sh"]
