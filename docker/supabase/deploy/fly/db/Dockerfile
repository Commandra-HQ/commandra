# Fly-specific: use subdir for PGDATA so volume mount (lost+found) is valid
FROM supabase/postgres:15.8.1.085
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh
ENTRYPOINT ["/entrypoint.sh"]
CMD ["postgres", "-D", "/etc/postgresql"]
