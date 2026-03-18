FROM kong/kong:3.9.1
COPY kong.fly.yml /home/kong/temp.yml
COPY kong-entrypoint.sh /home/kong/kong-entrypoint.sh
RUN chmod +x /home/kong/kong-entrypoint.sh
ENTRYPOINT ["/home/kong/kong-entrypoint.sh"]
