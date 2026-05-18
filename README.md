# Mini Centralized Exchange (CEX) Assignment

You are building a mini centralized exchange where the backend and engine communicate through Redis queues.

The backend does **not** perform order matching. It only accepts HTTP requests, sends commands to the engine through Redis, waits for the engine response, and returns the result to the client.

The engine owns the in-memory exchange state:

- balances
- order books
- orders
- fills

## Architecture

```txt
Frontend / API Client
        |
        v
Backend API (Express, port 3000)
        |
        v
Redis queue: backend-to-engine-broker
        |
        v
Engine process
        |
        v
Backend-specific response queue
        |
        v
Backend API Response
```

Every backend process creates its own response queue:

```ts
const RESPONSE_QUEUE = `response-queue-${BACKEND_QUEUE_ID}`;
```

Every message sent from the backend to the engine includes:

- `correlationId`
- `responseQueue`
- `type`
- `payload`

The engine must reply to `message.responseQueue` and include the same `correlationId`.

## Tech Stack

- TypeScript
- Bun
- Express
- Redis
- Prisma/Postgres
- JWT
- Zod

## Existing Code

### Backend

The backend is mostly complete. You should understand the flow, but you do not need to rewrite it.

Important files:

```txt
backend/src/index.ts
backend/src/routes/
backend/src/controllers/
backend/src/store/pending-responses.ts
backend/src/types/
backend/src/utils/engine-client.ts
backend/src/utils/auth.ts
backend/src/db.ts
```

The backend already:

- starts an Express server
- exposes HTTP routes
- validates request bodies with Zod
- creates users with Prisma
- signs JWTs for signup
- protects exchange routes with JWT auth
- sends engine commands to Redis queue `backend-to-engine-broker`
- listens on its own response queue
- uses `correlationId` to match engine replies to pending HTTP requests
- times out if the engine does not respond

The backend intentionally does **not** have completed signin logic. Students must implement `POST /signin` in:

```txt
backend/src/controllers/auth-controller.ts
```

Do this before using `CHECK-FLOW.md`, because the flow check requires a JWT token.

### Engine

The engine has the Redis flow boilerplate and type definitions, but the exchange logic is intentionally incomplete.

Important files:

```txt
engine/src/index.ts
engine/src/store/exchange-store.ts
engine/src/utils/env.ts
```

The engine already:

- connects to Redis
- listens forever on `backend-to-engine-broker`
- parses messages from the backend
- calls a TODO function where you must implement request handling
- sends the final response to `message.responseQueue`
- includes the same `correlationId` in the response

## Redis Message Format

Backend to engine:

```ts
interface EngineRequest {
  correlationId: string;
  responseQueue: string;
  type:
    | 'create_order'
    | 'get_depth'
    | 'get_user_balance'
    | 'get_order'
    | 'cancel_order';
  payload: Record<string, unknown>;
}
```

Engine to backend:

```ts
interface EngineResponse {
  correlationId: string;
  ok: boolean;
  data?: unknown;
  error?: string;
}
```

## Required API Endpoints

### DB-only endpoints

These are implemented in the backend and directly use Postgres through Prisma.

#### `POST /signup`

Creates a user.

Body:

```json
{
  "username": "alice",
  "password": "password123"
}
```

#### `POST /signin`

Signs in a user and returns a JWT.

This endpoint is intentionally incomplete in the boilerplate. Students must:

- validate the body with the existing auth Zod schema
- find the user by username
- compare the password with the stored hashed password
- return a JWT using the existing `createToken` helper
- return `401` for invalid credentials

Body:

```json
{
  "username": "alice",
  "password": "password123"
}
```

### Engine-backed endpoints

These endpoints are implemented in the backend, but they only work after you complete the engine logic.

All of these require:

```txt
Authorization: Bearer <jwt-token>
```

#### `POST /order`

Sends `create_order` to the engine.

Body:

```json
{
  "type": "limit",
  "side": "buy",
  "symbol": "BTC",
  "price": 100,
  "qty": 10
}
```

#### `GET /depth/:symbol`

Sends `get_depth` to the engine.

#### `GET /balance`

Sends `get_user_balance` to the engine.

#### `GET /order/:orderId`

Sends `get_order` to the engine.

#### `DELETE /order/:orderId`

Sends `cancel_order` to the engine.

## Your Task

You need to complete signin in the backend and then complete the engine.

Backend task:

```txt
backend/src/controllers/auth-controller.ts
```

Implement:

- `signin`

After signin works, use `CHECK-FLOW.md` to verify the backend → queue → engine → queue → backend flow.

Start from:

```txt
engine/src/index.ts
engine/src/store/exchange-store.ts
```

You must implement the logic for:

- `create_order`
- `get_depth`
- `get_user_balance`
- `get_order`
- `cancel_order`

You can organize your code however you want inside the `engine/` folder.

## Engine State

Use in-memory data structures only. Persistence is not required for the engine.

The boilerplate gives you these placeholders:

```ts
export const BALANCES = new Map<string, Record<string, Balance>>();
export const ORDERBOOKS = new Map<string, OrderBook>();
export const ORDERS = new Map<string, OrderRecord>();
export const FILLS: Fill[] = [];
```

You can keep these or change the internal structure if your implementation is clean and correct.

## Order Book Requirements

Implement:

- limit orders
- market orders if time permits
- buy orders matching against lowest asks
- sell orders matching against highest bids
- price-time priority
- partial fills
- remaining limit order quantity resting on the book
- order statuses:
  - `open`
  - `partially_filled`
  - `filled`
  - `cancelled`
- fills returned with each matched trade
- depth grouped by price level

## Matching Rules

A buy limit order can match with an ask when:

```ts
buyPrice >= askPrice;
```

A sell limit order can match with a bid when:

```ts
sellPrice <= bidPrice;
```

Market orders should match with the best available opposite side prices until filled or the book is empty.

## Depth Rules

`GET /depth/:symbol` should return:

```ts
{
  symbol: "BTC",
  bids: [
    { price: 100, qty: 10 },
    { price: 99, qty: 5 }
  ],
  asks: [
    { price: 110, qty: 4 },
    { price: 111, qty: 6 }
  ]
}
```

Bids must be sorted highest price first.

Asks must be sorted lowest price first.

## Balance Rules

For this assignment:

- seed balances in memory when the engine starts or when a user is first seen
- do not persist balances to the database
- `get_user_balance` should return balances from engine memory
- bonus: lock funds/assets for open limit orders

## Cancel Rules

`cancel_order` should:

- find the order
- return an error if the order does not exist
- return an error if the order is already filled
- remove remaining resting quantity from the order book
- mark the order as `cancelled`

## Running Locally

Start Redis and Postgres first.

Create env files:

```bash
cp backend/.env.example backend/.env
cp engine/.env.example engine/.env
```

Install dependencies:

```bash
cd backend
bun install

cd ../engine
bun install
```

Run backend:

```bash
cd backend
bun run dev
```

Run engine in another terminal:

```bash
cd engine
bun run dev
```

Backend runs on:

```txt
http://localhost:3000
```

The engine is a worker process. It listens on Redis queue:

```txt
backend-to-engine-broker
```

## Evaluation Criteria

You will be evaluated on:

- correct backend to engine Redis flow
- correct engine response to backend-specific response queue
- correct use of `correlationId`
- signup/signin using DB
- JWT protection on exchange endpoints
- order matching correctness
- partial fills
- depth sorting
- order status updates
- clean, readable TypeScript code

Focus on correctness and readable code over performance.
