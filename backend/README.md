# WaveHouse Backend

Requires Node.js 24 LTS and MongoDB. From this directory:

```sh
npm ci
```

Copy `.env.example` to `.env`, then run `npm run dev`. For compiled output,
run `npm run build` followed by `npm start`. Startup exits with an error if
MongoDB cannot be reached. SIGINT/SIGTERM close sockets and the database connection.

`PORT` defaults to 5000. `MONGO_URI` defaults to
`mongodb://127.0.0.1:27017/wavehouse_db`. `CORS_ORIGIN` optionally accepts a
comma-separated list of browser origins; otherwise all origins are allowed.

- `GET /`: process status.
- `GET /health`: 200 when MongoDB is connected, 503 otherwise.
- `GET /api-docs/`: Swagger UI; `/api-docs.json`: OpenAPI schema.
- Socket.IO `update_inventory` relays its payload as `inventory_changed`.
  This is a scaffold event and does not validate or persist inventory.

Run `npm test` for compilation and HTTP/Socket.IO regression tests. The tests
use an ephemeral HTTP port and do not require MongoDB.

From the repository root, `docker compose up --build` starts all services.
Warehouse CRUD and authentication are not implemented yet.
