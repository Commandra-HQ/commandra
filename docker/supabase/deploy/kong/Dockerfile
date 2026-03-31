FROM kong/kong:3.9.1
# Build context is the Commandra repo root (Railway); paths must be explicit.
COPY docker/supabase/deploy/kong/kong.yml /home/kong/temp.yml
COPY --chmod=755 docker/supabase/deploy/kong/kong-entrypoint.sh /tmp/kong-entrypoint.sh
ENTRYPOINT ["/tmp/kong-entrypoint.sh"]
