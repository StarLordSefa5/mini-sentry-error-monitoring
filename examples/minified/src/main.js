import { init, addBreadcrumb } from "@mini-sentry/sdk";
import { cartTotal } from "./cart.js";

export const RELEASE = "minified-demo@1.0.0";

const dsn = new URLSearchParams(location.search).get("dsn");
if (dsn) init({ dsn, release: RELEASE, environment: "production" });

document.getElementById("checkout").addEventListener("click", function onCheckout() {
  addBreadcrumb({ type: "custom", message: "Checkout clicked" });
  const cart = { items: [] };
  document.getElementById("total").textContent = cartTotal(cart);
});
