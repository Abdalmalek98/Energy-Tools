#!/usr/bin/env node
// Fake Anthropic Messages API for plumbing tests: returns a small valid sheet transcription. No key, no cost.
import { createServer } from "node:http";
const port = Number(process.argv[2] ?? 8790);
const row = (n, room) => ({ row: n, room_name: room, space_type: "OFFICE", floor: "GF", room_tag: `G${n}`, led: "LED", normal_emergency: "Normal", unit_desc: "2FT", lamp_desc: "T8", fixture_qty: 2, lamps_per_fixture: 2, lamp_watt: 18, color_temp: "6500K", voltage: 220, int_ext: "Internal", holder: "T8", mounted: "Surface", cutout: null, dimmable: "No", sensors: "No", ceiling: "Panel", height: 3, switch_status: "Good", dimensions: "4x4", remarks: null, uncertain: [], note: null });
let n = 0;
createServer((req, res) => {
  const chunks = []; req.on("data", (c) => chunks.push(c)); req.on("end", () => {
    n++;
    const body = JSON.parse(Buffer.concat(chunks).toString() || "{}");
    const imgs = (body.messages?.[0]?.content ?? []).filter((c) => c.type === "image").length;
    console.log(`[stub] request ${n}: model=${body.model} images=${imgs} key=${req.headers["x-api-key"] === "sk-stub" ? "ok" : "?"}`);
    const page = { header: { building_name: "STUB BUILDING", section: null, floor: "GF", collected_by: "STUB", date: "10-2-26", page_label: null, upright: true }, section_changes: [], rows: [row(1, "OFFICE"), row(2, "STORE")], copy_notes: [] };
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ content: [{ type: "text", text: JSON.stringify(page) }], usage: { input_tokens: 1000, output_tokens: 300 } }));
  });
}).listen(port, "127.0.0.1", () => console.log(`[stub] fake Anthropic on :${port}`));
