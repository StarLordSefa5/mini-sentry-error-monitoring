// Load test for the ingestion endpoint.
// Usage: k6 run -e PROJECT=<projectId> -e KEY=<apiKey> load/ingest.js
/* global __ENV -- provided by the k6 runtime */
import http from "k6/http";
import { check } from "k6";

const BASE_URL = __ENV.BASE_URL || "http://localhost:4000";
const url = `${BASE_URL}/api/${__ENV.PROJECT}/events?key=${__ENV.KEY}`;

export const options = {
  vus: 50, // 50 virtual users sending at the same time
  duration: "30s",
  thresholds: {
    http_req_failed: ["rate<0.01"], // fewer than 1% of requests may fail
    http_req_duration: ["p(95)<200"], // 95% of requests answered within 200 ms
  },
};

function uuid() {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === "x" ? r : (r & 3) | 8).toString(16);
  });
}

export default function () {
  const event = {
    eventId: uuid(),
    timestamp: new Date().toISOString(),
    platform: "browser",
    type: "TypeError",
    message: "k6 load test",
    frames: [
      {
        filename: "https://shop.example.com/assets/app.js",
        function: "checkout",
        lineno: 10,
        colno: 5,
      },
    ],
  };
  const res = http.post(url, JSON.stringify(event), { headers: { "content-type": "text/plain" } });
  check(res, { "accepted (202)": (r) => r.status === 202 });
}
