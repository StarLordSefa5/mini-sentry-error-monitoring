// Creates a demo account and project and sends realistic errors through the public API.
// Needs the API and the worker running. Usage: node scripts/seed-demo.mjs [apiUrl]
//
// Local development only. Demo login: demo@example.com / demo-password-123

const API = process.argv[2] ?? "http://localhost:4000";
const EMAIL = "demo@example.com";
const PASSWORD = "demo-password-123";

async function call(path, { cookie, body, method = body ? "POST" : "GET" } = {}) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      ...(body ? { "content-type": "application/json" } : {}),
      ...(cookie ? { cookie } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = res.status === 204 ? null : await res.json();
  return { res, data };
}

let { res, data } = await call("/api/auth/register", {
  body: { email: EMAIL, password: PASSWORD, name: "Demo User" },
});
if (res.status === 409)
  ({ res, data } = await call("/api/auth/login", { body: { email: EMAIL, password: PASSWORD } }));
if (!res.ok) throw new Error(`Login failed: ${res.status} ${JSON.stringify(data)}`);
const cookie = res.headers.get("set-cookie").split(";")[0];

const { data: list } = await call("/api/projects", { cookie });
const project =
  list.projects.find((p) => p.name === "Demo shop") ??
  (await call("/api/projects", { cookie, body: { name: "Demo shop" } })).data.project;

const agents = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_6) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15",
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1",
  "Mozilla/5.0 (X11; Linux x86_64; rv:133.0) Gecko/20100101 Firefox/133.0",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0",
];

const errors = [
  {
    weight: 60,
    type: "TypeError",
    message: () => "Cannot read properties of undefined (reading 'total')",
    path: "/checkout",
    stack: [
      ["CheckoutSummary", "/assets/checkout-BxK3a9Qz.js", 211, 34],
      ["renderWithHooks", "/assets/vendor-Ck2dE91a.js", 1123, 22],
      ["Array.map", "<anonymous>"],
    ],
  },
  {
    weight: 25,
    type: "Error",
    message: (i) => `Request failed with status ${i % 3 ? 502 : 504}: POST /api/orders/${1000 + i}`,
    path: "/checkout",
    stack: [
      ["submitOrder", "/assets/api-D4f8hJ2k.js", 48, 11],
      ["async handleSubmit", "/assets/checkout-BxK3a9Qz.js", 302, 7],
    ],
  },
  {
    weight: 12,
    type: "SyntaxError",
    message: () => "Unexpected token '<', \"<!DOCTYPE \"... is not valid JSON",
    path: "/products",
    stack: [
      ["JSON.parse", "<anonymous>"],
      ["loadCatalog", "/assets/catalog-Fq7Rt2Lm.js", 19, 28],
    ],
  },
  {
    weight: 6,
    type: "RangeError",
    message: () => "Maximum call stack size exceeded",
    path: "/products/42",
    stack: [
      ["flattenCategories", "/assets/catalog-Fq7Rt2Lm.js", 88, 5],
      ["flattenCategories", "/assets/catalog-Fq7Rt2Lm.js", 91, 12],
    ],
  },
  {
    weight: 3,
    type: "ChunkLoadError",
    message: (i) => `Loading chunk ${200 + i} failed.`,
    path: "/account",
    stack: [["requireEnsure", "/assets/index-A1b2C3d4.js", 5, 1440]],
  },
];

const origin = "https://shop.example.com";
let sent = 0;
for (const error of errors) {
  await Promise.all(
    Array.from({ length: error.weight }, async (_, i) => {
      const frames = error.stack.map(([fn, file, lineno, colno]) => ({
        function: fn,
        filename: file.startsWith("/") ? origin + file : file,
        ...(lineno ? { lineno, colno } : {}),
      }));
      const event = {
        eventId: crypto.randomUUID(),
        timestamp: new Date().toISOString(),
        platform: "browser",
        type: error.type,
        message: error.message(i),
        stack: `${error.type}: ${error.message(i)}\n${frames.map((f) => `    at ${f.function} (${f.filename}${f.lineno ? `:${f.lineno}:${f.colno}` : ""})`).join("\n")}`,
        frames,
        url: `${origin}${error.path}`,
        userAgent: agents[(i * 7 + error.weight) % agents.length],
        release: i % 4 ? "shop@2.4.1" : "shop@2.4.0",
        environment: "production",
      };
      const r = await fetch(`${API}/api/${project.id}/events?key=${project.apiKey}`, {
        method: "POST",
        headers: { "content-type": "text/plain" },
        body: JSON.stringify(event),
      });
      if (r.status === 202) sent++;
    }),
  );
}

console.log(`Sent ${sent} events to "${project.name}" (${project.id}).`);
console.log(`Log in at http://localhost:5173 as ${EMAIL}`);
