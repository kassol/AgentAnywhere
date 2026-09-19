import { SQL } from "bun"

const mode = process.argv[2]
const schema = process.argv[3]
if (!schema || !/^r2_bun_sql_diag_[a-z0-9_]+$/.test(schema)) throw new Error("invalid schema")

const databaseUrl = process.env.DATABASE_URL ?? (await Bun.stdin.text()).trim()
if (!databaseUrl) throw new Error("DATABASE_URL is required")

const quote = (value: string) => `"${value}"`
const qualified = (table: string) => `${quote(schema)}.${quote(table)}`
const admin = new SQL(databaseUrl, { max: 1 })

if (mode === "cleanup") {
  await admin.unsafe(`DROP SCHEMA IF EXISTS ${quote(schema)} CASCADE`)
  await admin.close()
  console.log(`cleanup schema=${schema}`)
  process.exit(0)
}

if (!new Set(["max1"]).has(mode)) throw new Error("invalid mode")
const max = 1
const started = performance.now()
let streamDone = 0
let detailDone = 0
let eventsDone = 0
let heartbeatDone = 0

const watchdog = setTimeout(() => {
  console.log(JSON.stringify({ result: "STALLED", bun: Bun.version, mode, elapsedMs: Math.round(performance.now() - started), streamDone, detailDone, eventsDone, heartbeatDone }))
  process.exit(124)
}, 8_000)

await admin.unsafe(`DROP SCHEMA IF EXISTS ${quote(schema)} CASCADE`)
await admin.unsafe(`CREATE SCHEMA ${quote(schema)}`)
await admin.unsafe(`CREATE TABLE ${qualified("state")} (id integer PRIMARY KEY, value integer NOT NULL DEFAULT 0)`)
await admin.unsafe(`CREATE TABLE ${qualified("events")} (seq bigserial PRIMARY KEY, event_id text NOT NULL UNIQUE, payload text NOT NULL)`)
for (let id = 1; id <= 32; id++) await admin.unsafe(`INSERT INTO ${qualified("state")} (id, value) VALUES ($1, 0)`, [id])

const db = new SQL(databaseUrl, { max })
const readDb = db

try {
  let writes = Promise.resolve()
  for (let i = 0; i < 240; i++) {
    writes = writes.then(() => db.begin(async sql => {
      await sql.unsafe(`UPDATE ${qualified("state")} SET value=value+1 WHERE id=$1`, [1 + i % 32])
      await Promise.resolve()
      await sql.unsafe(`INSERT INTO ${qualified("events")} (event_id, payload) VALUES ($1, $2)`, [`delta-${i}`, `payload-${i}`])
      streamDone++
    }))
  }

  const detailWorkers = Array.from({ length: 6 }, (_, worker) => (async () => {
    for (let i = 0; i < 80; i++) {
      await db.begin(async sql => {
        await sql.unsafe(`SELECT value FROM ${qualified("state")} WHERE id=$1`, [1 + (worker + i) % 32])
        await sql.unsafe(`SELECT seq FROM ${qualified("events")} WHERE seq>$1 ORDER BY seq LIMIT $2`, [Math.max(0, i - 10), 20])
      })
      detailDone++
    }
  })())

  const eventWorkers = Array.from({ length: 12 }, (_, worker) => (async () => {
    for (let i = 0; i < 100; i++) {
      await readDb.unsafe(`SELECT seq, event_id FROM ${qualified("events")} WHERE seq>$1 ORDER BY seq LIMIT $2`, [Math.max(0, worker * 5 + i - 20), 20])
      eventsDone++
    }
  })())

  const heartbeat = (async () => {
    for (let i = 0; i < 120; i++) {
      await db.unsafe(`UPDATE ${qualified("state")} SET value=value+0 WHERE id=$1`, [1 + i % 32])
      heartbeatDone++
    }
  })()

  await Promise.all([writes, heartbeat, ...detailWorkers, ...eventWorkers])
  const [{ count }] = await admin.unsafe(`SELECT count(*)::int AS count FROM ${qualified("events")}`)
  if (Number(count) !== 240) throw new Error(`wrong event count ${count}`)
  clearTimeout(watchdog)
  console.log(JSON.stringify({ result: "DONE", bun: Bun.version, mode, elapsedMs: Math.round(performance.now() - started), streamDone, detailDone, eventsDone, heartbeatDone }))
} finally {
  clearTimeout(watchdog)
  await db.close()
  await admin.unsafe(`DROP SCHEMA IF EXISTS ${quote(schema)} CASCADE`)
  await admin.close()
}
