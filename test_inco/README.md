# Inco basic test

This folder is a minimal harness to validate the Inco flow from the diagram:
encrypt intent values on the client, create a transaction that references the
encrypted handles, then sign (and optionally send) the transaction.

## What it does
- Runs a short encrypt loop for amount/threshold/guess/flag.
- Builds public intent metadata + PDAs (no plaintext).
- Builds a memo instruction referencing encrypted handles.
- Signs after encryption (optional simulate/send).

## Setup
```sh
cd test_inco
npm install
```

## Run
```sh
npm run test:inco
```

## Full flow (production-like)
Start the mock executor:
```sh
npm run mock:executor
```

In another terminal:
```sh
npm run test:inco:flow
```

### What this flow covers
- **Client encryption**: plaintext intent values are encrypted with Inco.
- **Intent signature**: user signs the intent after encryption.
- **Executor handoff**: encrypted intent is sent to a mock executor.
- **Transaction build**: executor builds a transaction (memo only) and returns it.
- **Optional simulate/send**: you can simulate or broadcast the returned tx.

## Environment options
- `INCO_TEST_ITERATIONS`: number of loop iterations (default 1).
- `INCO_SEND_TX=true`: broadcast the signed transaction.
- `INCO_SIMULATE_TX=true`: simulate the signed transaction.
- `INCO_SKIP_SIGN=true`: build but do not sign.
- `INCO_ENV_FILE`: custom env file path (default `../sol_setup/.env`).
- `VOID_EXECUTOR_PROGRAM_ID`: program ID used for PDA derivation.
- `INCO_INCLUDE_FULL_HANDLES=true`: include ciphertext in memo (may exceed size limits).
- `INCO_EXECUTOR_URL`: mock executor base URL (default `http://127.0.0.1:8787`).
- `INCO_EXECUTOR_PORT`: port for the mock executor (default `8787`; auto-increments if busy).

Reference docs: https://docs.inco.org/svm/home
