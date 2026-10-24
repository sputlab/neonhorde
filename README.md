# NEON HORDE

Vertical (9:16) horde-shooter / survivor-like web game.
Stack: HTML5 Canvas + vanilla JS (ES modules) + PHP 8 + MySQL 8. Installable PWA.

![Neon Horde](docs/images/hero.png)

## Repository layout

```
public/        Deployable web root (HTML, css/, js/, api/, icons/, assets/, sw.js, manifest)
database/      schema.sql (fresh install) and migrations/ (incl. idempotent safe_migrate.sql)
docs/          Detailed documentation (DEVELOPMENT.md) and promo images
CHANGELOG.md   Release history
```

## Quick start

1. Create the database: `mysql -u <user> -p < database/schema.sql`
   (WARNING: `schema.sql` drops and recreates tables. For existing installs use `database/migrations/safe_migrate.sql`.)
2. Configure secrets: `cp public/.env.example public/.env` and fill in DB credentials and a long random `APP_SECRET`.
   `.env` is git-ignored and blocked from web access by `public/.htaccess`.
3. Serve `public/` with Apache + PHP 8, or locally: `php -S localhost:8000 -t public`.

See [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) for architecture, anti-cheat, API and deployment details.

## License

Copyright (C) 2026 Sputlab. Licensed under the [GNU Affero General Public License v3.0](LICENSE) (AGPL-3.0-or-later).
If you run a modified version as a network service, you must offer its source code to your users.
